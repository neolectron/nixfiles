import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.HexFormat;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.ConstantDynamic;
import org.objectweb.asm.FieldVisitor;
import org.objectweb.asm.Handle;
import org.objectweb.asm.Label;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;

/**
 * Analysis-gated JAR transformer for the Bitwig conference PoC.
 *
 * It discovers a name-independent startup anchor before modifying a class. If
 * the anchor is ambiguous or absent, it exits without producing output.
 */
public final class BitwigJarTransformer {
  private static final String MAIN_CLASS = "com/bitwig/flt/app/BitwigStudioMain";
  private static final String HELPER_CLASS = "com/bitwig/flt/app/BitwigActivationInitializer";
  private static final String MAIN_ENTRY = MAIN_CLASS + ".class";
  private static final String HELPER_ENTRY = HELPER_CLASS + ".class";

  private static final Pattern HASH_PATTERN = Pattern.compile(
      "\\\"target_sha256\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
  private static final Pattern CLASS_PATTERN = Pattern.compile(
      "\\{\\s*\\\"source\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*,\\s*"
          + "\\\"target\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*\\}");
  private static final Pattern FIELD_PATTERN = Pattern.compile(
      "\\{\\s*\\\"source_owner\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*,\\s*"
          + "\\\"source_name\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*,\\s*"
          + "\\\"source_descriptor\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*,\\s*"
          + "\\\"target_owner\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*,\\s*"
          + "\\\"target_name\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*,\\s*"
          + "\\\"target_descriptor\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*\\}");
  private static final Pattern METHOD_PATTERN = FIELD_PATTERN;
  private static final Pattern ROLE_PATTERN = Pattern.compile(
      "\\{\\s*\\\"role\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*,\\s*"
          + "\\\"owner\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*,\\s*"
          + "\\\"method\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*,\\s*"
          + "\\\"descriptor\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*\\}");

  private record Anchor(String owner, String accessor, String methodName, String methodDesc) {}

  private record MemberRef(String owner, String name, String descriptor) {}

  private record MemberTarget(String owner, String name, String descriptor) {}

  private record RoleTarget(String owner, String method, String descriptor) {}

  private static final class ResolvedMap {
    final String targetSha256;
    final Map<String, String> classes;
    final Map<MemberRef, MemberTarget> fields;
    final Map<MemberRef, MemberTarget> methods;
    final Map<String, RoleTarget> roles;

    ResolvedMap(
        String targetSha256,
        Map<String, String> classes,
        Map<MemberRef, MemberTarget> fields,
        Map<MemberRef, MemberTarget> methods,
        Map<String, RoleTarget> roles) {
      this.targetSha256 = targetSha256;
      this.classes = Map.copyOf(classes);
      this.fields = Map.copyOf(fields);
      this.methods = Map.copyOf(methods);
      this.roles = Map.copyOf(roles);
    }

    String mapType(String internalName) {
      if (internalName.startsWith("[")) {
        return mapDescriptor(internalName);
      }
      return classes.getOrDefault(internalName, internalName);
    }

    Type mapType(Type type) {
      return switch (type.getSort()) {
        case Type.ARRAY -> {
          Type element = mapType(type.getElementType());
          yield Type.getType("[".repeat(type.getDimensions()) + element.getDescriptor());
        }
        case Type.OBJECT -> Type.getObjectType(mapType(type.getInternalName()));
        case Type.METHOD -> {
          Type[] arguments = type.getArgumentTypes();
          for (int index = 0; index < arguments.length; index++) {
            arguments[index] = mapType(arguments[index]);
          }
          yield Type.getMethodType(mapType(type.getReturnType()), arguments);
        }
        default -> type;
      };
    }

    String mapDescriptor(String descriptor) {
      return mapType(Type.getType(descriptor)).getDescriptor();
    }

    MemberTarget mapField(String owner, String name, String descriptor) {
      return fields.getOrDefault(
          new MemberRef(owner, name, descriptor),
          new MemberTarget(mapType(owner), name, mapDescriptor(descriptor)));
    }

    MemberTarget mapMethod(String owner, String name, String descriptor) {
      return methods.getOrDefault(
          new MemberRef(owner, name, descriptor),
          new MemberTarget(mapType(owner), name, mapDescriptor(descriptor)));
    }

    RoleTarget role(String name) {
      RoleTarget role = roles.get(name);
      if (role == null) {
        throw new IllegalStateException("resolved mapping is missing role: " + name);
      }
      return role;
    }
  }

  private static final class Candidate {
    final String owner;
    final String accessor;
    boolean hasStringUse;
    boolean hasBooleanUse;
    String injectionMethodName;
    String injectionMethodDesc;

    Candidate(String owner, String accessor) {
      this.owner = owner;
      this.accessor = accessor;
    }
  }

  private static final class AnchorScanner extends ClassVisitor {
    private final Map<String, Candidate> candidates = new HashMap<>();

    AnchorScanner() {
      super(Opcodes.ASM9);
    }

    @Override
    public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
      MethodVisitor parent = super.visitMethod(access, name, descriptor, signature, exceptions);
      return new MethodVisitor(Opcodes.ASM9, parent) {
        private Candidate pending;

        @Override
        public void visitMethodInsn(int opcode, String owner, String method, String desc, boolean isInterface) {
          if (pending != null) {
            if (opcode == Opcodes.INVOKEVIRTUAL && owner.equals(pending.owner)) {
              if (desc.equals("()Ljava/lang/String;")) {
                pending.hasStringUse = true;
                pending.injectionMethodName = name;
                pending.injectionMethodDesc = descriptor;
              } else if (desc.equals("()Z")) {
                pending.hasBooleanUse = true;
              }
            }
            pending = null;
          }

          if (opcode == Opcodes.INVOKESTATIC && desc.equals("()L" + owner + ";")) {
            String key = owner + "\u0000" + method;
            pending = candidates.computeIfAbsent(key, ignored -> new Candidate(owner, method));
          }
          super.visitMethodInsn(opcode, owner, method, desc, isInterface);
        }
      };
    }

    Anchor resolve() {
      Candidate resolved = null;
      for (Candidate candidate : candidates.values()) {
        if (!candidate.hasStringUse || !candidate.hasBooleanUse || candidate.injectionMethodName == null) {
          continue;
        }
        if (resolved != null) {
          throw new IllegalStateException("startup anchor is ambiguous");
        }
        resolved = candidate;
      }
      if (resolved == null) {
        throw new IllegalStateException("no compatible startup anchor found");
      }
      return new Anchor(
          resolved.owner,
          resolved.accessor,
          resolved.injectionMethodName,
          resolved.injectionMethodDesc);
    }
  }

  private static byte[] readAll(InputStream input) throws IOException {
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    input.transferTo(output);
    return output.toByteArray();
  }

  private static String sha256(Path path) throws IOException {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      try (InputStream input = Files.newInputStream(path)) {
        byte[] buffer = new byte[64 * 1024];
        int count;
        while ((count = input.read(buffer)) >= 0) {
          digest.update(buffer, 0, count);
        }
      }
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException(exception);
    }
  }

  private static ResolvedMap readResolvedMap(Path path) throws IOException {
    String json = Files.readString(path);
    Matcher hashMatcher = HASH_PATTERN.matcher(json);
    if (!hashMatcher.find()) {
      throw new IllegalStateException("resolved mapping has no target SHA-256");
    }

    Map<String, String> classes = new HashMap<>();
    Matcher classMatcher = CLASS_PATTERN.matcher(json);
    while (classMatcher.find()) {
      classes.put(classMatcher.group(1), classMatcher.group(2));
    }

    Map<MemberRef, MemberTarget> fields = new HashMap<>();
    Map<MemberRef, MemberTarget> methods = new HashMap<>();
    Matcher memberMatcher = FIELD_PATTERN.matcher(json);
    int methodsOffset = json.indexOf("\"methods\"");
    int rolesOffset = json.indexOf("\"roles\"");
    while (memberMatcher.find()) {
      MemberRef source = new MemberRef(
          memberMatcher.group(1), memberMatcher.group(2), memberMatcher.group(3));
      MemberTarget target = new MemberTarget(
          memberMatcher.group(4), memberMatcher.group(5), memberMatcher.group(6));
      if (memberMatcher.start() < methodsOffset) {
        fields.put(source, target);
      } else if (memberMatcher.start() < rolesOffset) {
        methods.put(source, target);
      }
    }

    Map<String, RoleTarget> roles = new HashMap<>();
    Matcher roleMatcher = ROLE_PATTERN.matcher(json);
    while (roleMatcher.find()) {
      roles.put(roleMatcher.group(1), new RoleTarget(
          roleMatcher.group(2), roleMatcher.group(3), roleMatcher.group(4)));
    }
    if (classes.isEmpty() || methods.isEmpty() || roles.size() != 3) {
      throw new IllegalStateException("resolved mapping is incomplete");
    }
    return new ResolvedMap(hashMatcher.group(1), classes, fields, methods, roles);
  }

  private static Handle mapHandle(Handle handle, ResolvedMap mappings) {
    boolean field = handle.getTag() >= Opcodes.H_GETFIELD && handle.getTag() <= Opcodes.H_PUTSTATIC;
    MemberTarget target = field
        ? mappings.mapField(handle.getOwner(), handle.getName(), handle.getDesc())
        : mappings.mapMethod(handle.getOwner(), handle.getName(), handle.getDesc());
    return new Handle(handle.getTag(), target.owner, target.name, target.descriptor, handle.isInterface());
  }

  private static Object mapConstant(Object value, ResolvedMap mappings) {
    if (value instanceof Type type) {
      return mappings.mapType(type);
    }
    if (value instanceof Handle handle) {
      return mapHandle(handle, mappings);
    }
    if (value instanceof ConstantDynamic dynamic) {
      Object[] arguments = new Object[dynamic.getBootstrapMethodArgumentCount()];
      for (int index = 0; index < arguments.length; index++) {
        arguments[index] = mapConstant(dynamic.getBootstrapMethodArgument(index), mappings);
      }
      return new ConstantDynamic(
          dynamic.getName(),
          mappings.mapDescriptor(dynamic.getDescriptor()),
          mapHandle(dynamic.getBootstrapMethod(), mappings),
          arguments);
    }
    return value;
  }

  private static Object[] mapFrame(Object[] values, int count, ResolvedMap mappings) {
    if (values == null) {
      return null;
    }
    Object[] result = Arrays.copyOf(values, count);
    for (int index = 0; index < count; index++) {
      if (result[index] instanceof String type) {
        result[index] = mappings.mapType(type);
      }
    }
    return result;
  }

  private static byte[] remapLicenseParser(byte[] parserClass, ResolvedMap mappings) {
    ClassReader reader = new ClassReader(parserClass);
    ClassWriter writer = new ClassWriter(reader, 0);
    ClassVisitor remapper = new ClassVisitor(Opcodes.ASM9, writer) {
      @Override
      public void visit(int version, int access, String name, String signature, String superName, String[] interfaces) {
        String[] mappedInterfaces = new String[interfaces.length];
        for (int index = 0; index < interfaces.length; index++) {
          mappedInterfaces[index] = mappings.mapType(interfaces[index]);
        }
        super.visit(
            version,
            access,
            mappings.mapType(name),
            null,
            superName == null ? null : mappings.mapType(superName),
            mappedInterfaces);
      }

      @Override
      public void visitNestHost(String nestHost) {
        super.visitNestHost(mappings.mapType(nestHost));
      }

      @Override
      public void visitOuterClass(String owner, String name, String descriptor) {
        if (name == null || descriptor == null) {
          super.visitOuterClass(mappings.mapType(owner), name, descriptor);
          return;
        }
        MemberTarget target = mappings.mapMethod(owner, name, descriptor);
        super.visitOuterClass(target.owner, target.name, target.descriptor);
      }

      @Override
      public void visitNestMember(String nestMember) {
        super.visitNestMember(mappings.mapType(nestMember));
      }

      @Override
      public void visitPermittedSubclass(String permittedSubclass) {
        super.visitPermittedSubclass(mappings.mapType(permittedSubclass));
      }

      @Override
      public void visitInnerClass(String name, String outerName, String innerName, int access) {
        super.visitInnerClass(
            mappings.mapType(name),
            outerName == null ? null : mappings.mapType(outerName),
            innerName,
            access);
      }

      @Override
      public FieldVisitor visitField(int access, String name, String descriptor, String signature, Object value) {
        String sourceOwner = reader.getClassName();
        MemberTarget target = mappings.mapField(sourceOwner, name, descriptor);
        return super.visitField(access, target.name, target.descriptor, null, mapConstant(value, mappings));
      }

      @Override
      public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
        String sourceOwner = reader.getClassName();
        MemberTarget declaration = mappings.mapMethod(sourceOwner, name, descriptor);
        String[] mappedExceptions = exceptions == null ? null : new String[exceptions.length];
        if (exceptions != null) {
          for (int index = 0; index < exceptions.length; index++) {
            mappedExceptions[index] = mappings.mapType(exceptions[index]);
          }
        }
        MethodVisitor parent = super.visitMethod(
            access, declaration.name, declaration.descriptor, null, mappedExceptions);
        return new MethodVisitor(Opcodes.ASM9, parent) {
          @Override
          public void visitFrame(int type, int numLocal, Object[] local, int numStack, Object[] stack) {
            super.visitFrame(
                type,
                numLocal,
                mapFrame(local, numLocal, mappings),
                numStack,
                mapFrame(stack, numStack, mappings));
          }

          @Override
          public void visitTypeInsn(int opcode, String type) {
            super.visitTypeInsn(opcode, mappings.mapType(type));
          }

          @Override
          public void visitFieldInsn(int opcode, String owner, String fieldName, String fieldDescriptor) {
            MemberTarget target = mappings.mapField(owner, fieldName, fieldDescriptor);
            super.visitFieldInsn(opcode, target.owner, target.name, target.descriptor);
          }

          @Override
          public void visitMethodInsn(int opcode, String owner, String method, String methodDescriptor, boolean isInterface) {
            MemberTarget target = mappings.mapMethod(owner, method, methodDescriptor);
            super.visitMethodInsn(opcode, target.owner, target.name, target.descriptor, isInterface);
          }

          @Override
          public void visitInvokeDynamicInsn(String name, String descriptor, Handle bootstrap, Object... arguments) {
            Object[] mappedArguments = new Object[arguments.length];
            for (int index = 0; index < arguments.length; index++) {
              mappedArguments[index] = mapConstant(arguments[index], mappings);
            }
            super.visitInvokeDynamicInsn(
                name,
                mappings.mapDescriptor(descriptor),
                mapHandle(bootstrap, mappings),
                mappedArguments);
          }

          @Override
          public void visitLdcInsn(Object value) {
            super.visitLdcInsn(mapConstant(value, mappings));
          }

          @Override
          public void visitMultiANewArrayInsn(String descriptor, int dimensions) {
            super.visitMultiANewArrayInsn(mappings.mapDescriptor(descriptor), dimensions);
          }

          @Override
          public void visitTryCatchBlock(Label start, Label end, Label handler, String type) {
            super.visitTryCatchBlock(start, end, handler, type == null ? null : mappings.mapType(type));
          }

          @Override
          public void visitLocalVariable(
              String name, String descriptor, String signature, Label start, Label end, int index) {
            super.visitLocalVariable(
                name, mappings.mapDescriptor(descriptor), null, start, end, index);
          }
        };
      }
    };
    reader.accept(remapper, 0);
    return writer.toByteArray();
  }

  private static Anchor findAnchor(byte[] mainClass) {
    AnchorScanner scanner = new AnchorScanner();
    new ClassReader(mainClass).accept(scanner, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
    return scanner.resolve();
  }

  private static byte[] transformMainClass(byte[] mainClass, Anchor anchor) {
    ClassReader reader = new ClassReader(mainClass);
    ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
    ClassVisitor transformer = new ClassVisitor(Opcodes.ASM9, writer) {
      @Override
      public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
        MethodVisitor parent = super.visitMethod(access, name, descriptor, signature, exceptions);
        if (!name.equals(anchor.methodName) || !descriptor.equals(anchor.methodDesc)) {
          return parent;
        }
        return new MethodVisitor(Opcodes.ASM9, parent) {
          private boolean injected;

          @Override
          public void visitMethodInsn(int opcode, String owner, String method, String desc, boolean isInterface) {
            if (!injected
                && opcode == Opcodes.INVOKESTATIC
                && owner.equals(anchor.owner)
                && method.equals(anchor.accessor)
                && desc.equals("()L" + anchor.owner + ";")) {
              super.visitMethodInsn(Opcodes.INVOKESTATIC, HELPER_CLASS, "ensure", "()V", false);
              injected = true;
            }
            super.visitMethodInsn(opcode, owner, method, desc, isInterface);
          }

          @Override
          public void visitEnd() {
            if (!injected) {
              throw new IllegalStateException("resolved anchor was not present in selected method");
            }
            super.visitEnd();
          }
        };
      }
    };
    reader.accept(transformer, 0);
    return writer.toByteArray();
  }

  private static byte[] transformLicenseModel(byte[] licenseModelClass, RoleTarget role) {
    ClassReader reader = new ClassReader(licenseModelClass);
    ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
    int[] matches = {0};
    ClassVisitor transformer = new ClassVisitor(Opcodes.ASM9, writer) {
      @Override
      public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
        MethodVisitor target = super.visitMethod(access, name, descriptor, signature, exceptions);
        if (!name.equals(role.method) || !descriptor.equals(role.descriptor)) {
          return target;
        }
        matches[0]++;
        return new MethodVisitor(Opcodes.ASM9) {
          @Override
          public void visitCode() {
            target.visitCode();
            target.visitInsn(Opcodes.ACONST_NULL);
            target.visitInsn(Opcodes.ARETURN);
            target.visitMaxs(1, 1);
            target.visitEnd();
          }
        };
      }
    };
    reader.accept(transformer, 0);
    if (matches[0] != 1) {
      throw new IllegalStateException(
          "expected exactly one trial-descriptor method, found " + matches[0]);
    }
    return writer.toByteArray();
  }

  private static byte[] transformLicenseState(byte[] licenseStateClass, RoleTarget role) {
    ClassReader reader = new ClassReader(licenseStateClass);
    ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
    int[] matches = {0};
    ClassVisitor transformer = new ClassVisitor(Opcodes.ASM9, writer) {
      @Override
      public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
        MethodVisitor target = super.visitMethod(access, name, descriptor, signature, exceptions);
        if (!name.equals(role.method) || !descriptor.equals(role.descriptor)) {
          return target;
        }
        matches[0]++;
        return new MethodVisitor(Opcodes.ASM9) {
          @Override
          public void visitCode() {
            target.visitCode();
            target.visitInsn(Opcodes.ICONST_1);
            target.visitInsn(Opcodes.IRETURN);
            target.visitMaxs(1, 2);
            target.visitEnd();
          }
        };
      }
    };
    reader.accept(transformer, 0);
    if (matches[0] != 1) {
      throw new IllegalStateException(
          "expected exactly one license-eligibility method, found " + matches[0]);
    }
    return writer.toByteArray();
  }

  private static void writeEntry(ZipOutputStream output, ZipEntry source, byte[] content) throws IOException {
    writeEntry(output, source, source.getName(), content);
  }

  private static void writeEntry(
      ZipOutputStream output, ZipEntry source, String targetName, byte[] content) throws IOException {
    ZipEntry target = new ZipEntry(targetName);
    if (source.getTime() >= 0) {
      target.setTime(source.getTime());
    } else {
      // New entries (notably the generated helper class) have no source
      // timestamp. Pin them to the ZIP epoch instead of embedding the build
      // clock, so identical inputs produce a byte-identical JAR.
      target.setTime(0L);
    }
    output.putNextEntry(target);
    output.write(content);
    output.closeEntry();
  }

  /** Test-only utility used to validate the resolver against renamed symbols. */
  private static void remapFixture(Path inputJar, Path outputJar, Path resolvedMapPath) throws IOException {
    ResolvedMap mappings = readResolvedMap(resolvedMapPath);
    try (ZipFile input = new ZipFile(inputJar.toFile());
        OutputStream fileOutput = Files.newOutputStream(outputJar);
        ZipOutputStream output = new ZipOutputStream(fileOutput)) {
      Enumeration<? extends ZipEntry> entries = input.entries();
      while (entries.hasMoreElements()) {
        ZipEntry entry = entries.nextElement();
        if (entry.isDirectory()) {
          continue;
        }
        try (InputStream entryInput = input.getInputStream(entry)) {
          byte[] content = readAll(entryInput);
          if (entry.getName().endsWith(".class")) {
            content = remapLicenseParser(content, mappings);
            String mappedName = new ClassReader(content).getClassName() + ".class";
            writeEntry(output, entry, mappedName, content);
          } else {
            writeEntry(output, entry, content);
          }
        }
      }
    }
  }

  private static void transform(
      Path inputJar,
      Path outputJar,
      Path helperClass,
      Path licenseParserClass,
      Path resolvedMapPath) throws IOException {
    ResolvedMap mappings = readResolvedMap(resolvedMapPath);
    String inputSha256 = sha256(inputJar);
    if (!inputSha256.equals(mappings.targetSha256)) {
      throw new IllegalStateException(
          "resolved mapping targets " + mappings.targetSha256 + " but input JAR is " + inputSha256);
    }
    RoleTarget parserRole = mappings.role("license_parser");
    RoleTarget modelRole = mappings.role("trial_descriptor");
    RoleTarget stateRole = mappings.role("license_eligibility");
    String parserEntryName = parserRole.owner + ".class";
    String modelEntryName = modelRole.owner + ".class";
    String stateEntryName = stateRole.owner + ".class";

    byte[] helper = Files.readAllBytes(helperClass);
    byte[] licenseParser = remapLicenseParser(Files.readAllBytes(licenseParserClass), mappings);
    try (ZipFile input = new ZipFile(inputJar.toFile());
        OutputStream fileOutput = Files.newOutputStream(outputJar);
        ZipOutputStream output = new ZipOutputStream(fileOutput)) {
      ZipEntry mainEntry = input.getEntry(MAIN_ENTRY);
      if (mainEntry == null) {
        throw new IllegalStateException("Bitwig startup class is missing");
      }
      byte[] mainClass;
      try (InputStream mainInput = input.getInputStream(mainEntry)) {
        mainClass = readAll(mainInput);
      }
      byte[] transformedMain = transformMainClass(mainClass, findAnchor(mainClass));
      ZipEntry licenseModelEntry = input.getEntry(modelEntryName);
      if (licenseModelEntry == null) {
        throw new IllegalStateException("mapped Bitwig license model is missing: " + modelEntryName);
      }
      byte[] licenseModel;
      try (InputStream licenseModelInput = input.getInputStream(licenseModelEntry)) {
        licenseModel = transformLicenseModel(readAll(licenseModelInput), modelRole);
      }
      ZipEntry licenseStateEntry = input.getEntry(stateEntryName);
      if (licenseStateEntry == null) {
        throw new IllegalStateException("mapped Bitwig license state is missing: " + stateEntryName);
      }
      byte[] licenseState;
      try (InputStream licenseStateInput = input.getInputStream(licenseStateEntry)) {
        licenseState = transformLicenseState(readAll(licenseStateInput), stateRole);
      }

      if (input.getEntry(parserEntryName) == null) {
        throw new IllegalStateException("mapped Bitwig license parser is missing: " + parserEntryName);
      }

      Enumeration<? extends ZipEntry> entries = input.entries();
      int parserReplacements = 0;
      while (entries.hasMoreElements()) {
        ZipEntry entry = entries.nextElement();
        if (entry.isDirectory() || entry.getName().equals(HELPER_ENTRY)) {
          continue;
        }
        if (entry.getName().equals(MAIN_ENTRY)) {
          writeEntry(output, entry, transformedMain);
          continue;
        }
        if (entry.getName().equals(parserEntryName)) {
          writeEntry(output, entry, licenseParser);
          parserReplacements++;
          continue;
        }
        if (entry.getName().equals(modelEntryName)) {
          writeEntry(output, entry, licenseModel);
          continue;
        }
        if (entry.getName().equals(stateEntryName)) {
          writeEntry(output, entry, licenseState);
          continue;
        }
        try (InputStream entryInput = input.getInputStream(entry)) {
          writeEntry(output, entry, readAll(entryInput));
        }
      }
      if (parserReplacements != 1) {
        throw new IllegalStateException(
            "expected exactly one mapped parser entry, replaced " + parserReplacements);
      }
      writeEntry(output, new ZipEntry(HELPER_ENTRY), helper);
    }
  }

  public static void main(String[] args) throws Exception {
    if (args.length == 4 && args[0].equals("--remap-fixture")) {
      remapFixture(Path.of(args[1]), Path.of(args[2]), Path.of(args[3]));
      return;
    }
    if (args.length != 5) {
      System.err.println(
          "usage: BitwigJarTransformer INPUT_JAR OUTPUT_JAR HELPER_CLASS LICENSE_PARSER_CLASS RESOLVED_MAP_JSON\n"
              + "       BitwigJarTransformer --remap-fixture INPUT_JAR OUTPUT_JAR RENAME_MAP_JSON");
      System.exit(2);
    }
    transform(
        Path.of(args[0]),
        Path.of(args[1]),
        Path.of(args[2]),
        Path.of(args[3]),
        Path.of(args[4]));
  }
}
