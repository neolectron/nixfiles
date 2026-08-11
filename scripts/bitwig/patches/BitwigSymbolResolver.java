import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.FieldVisitor;
import org.objectweb.asm.Handle;
import org.objectweb.asm.Label;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;

/**
 * Resolves the obfuscated symbol closure needed by the Bitwig patch.
 *
 * The reference names identify semantic roles in the reviewed 6.0.6 build.
 * Target names are selected by normalized class/member structure: obfuscated
 * owners and member names are excluded from the fingerprint, while bytecode
 * opcodes, literals, JVM type shapes, declaration order, and self-member
 * references are retained. Every required class must have exactly one target
 * candidate or no mapping is emitted.
 */
public final class BitwigSymbolResolver {
  private static final Pattern REFERENCE_HASH_PATTERN = Pattern.compile(
      "\\\"reference_sha256\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
  private static final Pattern CLASSES_PATTERN = Pattern.compile(
      "\\\"classes\\\"\\s*:\\s*\\[(.*?)]", Pattern.DOTALL);
  private static final Pattern STRING_PATTERN = Pattern.compile("\\\"([^\\\"]+)\\\"");
  private static final Pattern ROLE_PATTERN = Pattern.compile(
      "\\{\\s*\\\"role\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*,\\s*"
          + "\\\"owner\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*,\\s*"
          + "\\\"method\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*,\\s*"
          + "\\\"descriptor\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"\\s*\\}");

  private record MemberKey(String name, String descriptor) {}

  private record FieldShape(int access, String name, String descriptor, Object value) {}

  private static final class MethodShape {
    final int access;
    final String name;
    final String descriptor;
    String code = "";

    MethodShape(int access, String name, String descriptor) {
      this.access = access;
      this.name = name;
      this.descriptor = descriptor;
    }
  }

  private static final class ClassShape {
    final String name;
    final int access;
    final String superName;
    final List<String> interfaces;
    final List<FieldShape> fields;
    final List<MethodShape> methods;
    final Map<MemberKey, Integer> fieldIndexes;
    final Map<MemberKey, Integer> methodIndexes;
    final String fingerprint;

    ClassShape(
        String name,
        int access,
        String superName,
        List<String> interfaces,
        List<FieldShape> fields,
        List<MethodShape> methods,
        Map<MemberKey, Integer> fieldIndexes,
        Map<MemberKey, Integer> methodIndexes,
        String fingerprint) {
      this.name = name;
      this.access = access;
      this.superName = superName;
      this.interfaces = interfaces;
      this.fields = fields;
      this.methods = methods;
      this.fieldIndexes = fieldIndexes;
      this.methodIndexes = methodIndexes;
      this.fingerprint = fingerprint;
    }
  }

  private record ClassMapping(ClassShape source, ClassShape target) {}

  private record Role(
      String role, String owner, String method, String descriptor) {}

  private record PatchSpec(String referenceSha256, List<String> classes, List<Role> roles) {}

  private static PatchSpec readPatchSpec(Path path) throws IOException {
    String json = Files.readString(path);
    Matcher hashMatcher = REFERENCE_HASH_PATTERN.matcher(json);
    Matcher classesMatcher = CLASSES_PATTERN.matcher(json);
    if (!hashMatcher.find() || !classesMatcher.find()) {
      throw new IllegalStateException("patch specification is missing its reference hash or classes");
    }
    List<String> classes = new ArrayList<>();
    Matcher stringMatcher = STRING_PATTERN.matcher(classesMatcher.group(1));
    while (stringMatcher.find()) {
      classes.add(stringMatcher.group(1));
    }
    List<Role> roles = new ArrayList<>();
    Matcher roleMatcher = ROLE_PATTERN.matcher(json);
    while (roleMatcher.find()) {
      roles.add(new Role(
          roleMatcher.group(1), roleMatcher.group(2), roleMatcher.group(3), roleMatcher.group(4)));
    }
    if (classes.isEmpty() || roles.isEmpty()) {
      throw new IllegalStateException("patch specification has no classes or roles");
    }
    return new PatchSpec(hashMatcher.group(1), List.copyOf(classes), List.copyOf(roles));
  }

  private static byte[] readAll(InputStream input) throws IOException {
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    input.transferTo(output);
    return output.toByteArray();
  }

  private static Map<String, byte[]> readClasses(Path jar) throws IOException {
    Map<String, byte[]> classes = new TreeMap<>();
    try (ZipFile zip = new ZipFile(jar.toFile())) {
      var entries = zip.entries();
      while (entries.hasMoreElements()) {
        ZipEntry entry = entries.nextElement();
        if (!entry.isDirectory() && entry.getName().endsWith(".class")) {
          try (InputStream input = zip.getInputStream(entry)) {
            byte[] bytes = readAll(input);
            classes.put(new ClassReader(bytes).getClassName(), bytes);
          }
        }
      }
    }
    return classes;
  }

  private static String stableType(String internalName) {
    if (internalName == null) {
      return "";
    }
    return internalName.startsWith("java/")
            || internalName.startsWith("javax/")
            || internalName.startsWith("jdk/")
            || internalName.startsWith("sun/")
        ? internalName
        : "?";
  }

  private static String typeShape(Type type) {
    return switch (type.getSort()) {
      case Type.VOID -> "V";
      case Type.BOOLEAN -> "Z";
      case Type.CHAR -> "C";
      case Type.BYTE -> "B";
      case Type.SHORT -> "S";
      case Type.INT -> "I";
      case Type.FLOAT -> "F";
      case Type.LONG -> "J";
      case Type.DOUBLE -> "D";
      case Type.ARRAY -> "[".repeat(type.getDimensions()) + typeShape(type.getElementType());
      case Type.OBJECT -> "L" + stableType(type.getInternalName()) + ";";
      case Type.METHOD -> {
        StringBuilder result = new StringBuilder("(");
        for (Type argument : type.getArgumentTypes()) {
          result.append(typeShape(argument));
        }
        yield result.append(')').append(typeShape(type.getReturnType())).toString();
      }
      default -> throw new IllegalArgumentException("unknown JVM type: " + type);
    };
  }

  private static String descriptorShape(String descriptor) {
    return typeShape(Type.getType(descriptor));
  }

  private static int normalizedAccess(int access) {
    return access & ~(Opcodes.ACC_SYNTHETIC | Opcodes.ACC_DEPRECATED);
  }

  private static String constantShape(Object value) {
    if (value == null) {
      return "null";
    }
    if (value instanceof Type type) {
      return "type:" + typeShape(type);
    }
    if (value instanceof Handle handle) {
      return "handle:"
          + handle.getTag()
          + ':'
          + stableType(handle.getOwner())
          + ':'
          + (stableType(handle.getOwner()).equals("?") ? "?" : handle.getName())
          + ':'
          + descriptorShape(handle.getDesc());
    }
    return value.getClass().getName() + ':' + value;
  }

  private static String sha256(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException(exception);
    }
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

  private static ClassShape analyze(byte[] classBytes) {
    ClassReader reader = new ClassReader(classBytes);
    List<FieldShape> fields = new ArrayList<>();
    List<MethodShape> methods = new ArrayList<>();
    Map<MemberKey, Integer> fieldIndexes = new LinkedHashMap<>();
    Map<MemberKey, Integer> methodIndexes = new LinkedHashMap<>();
    String[] className = new String[1];
    int[] classAccess = new int[1];
    String[] superName = new String[1];
    List<String> interfaces = new ArrayList<>();

    reader.accept(new ClassVisitor(Opcodes.ASM9) {
      @Override
      public void visit(int version, int access, String name, String signature, String parent, String[] implemented) {
        className[0] = name;
        classAccess[0] = access;
        superName[0] = parent;
        interfaces.addAll(Arrays.asList(implemented));
      }

      @Override
      public FieldVisitor visitField(int access, String name, String descriptor, String signature, Object value) {
        fieldIndexes.put(new MemberKey(name, descriptor), fields.size());
        fields.add(new FieldShape(access, name, descriptor, value));
        return null;
      }

      @Override
      public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
        methodIndexes.put(new MemberKey(name, descriptor), methods.size());
        methods.add(new MethodShape(access, name, descriptor));
        return null;
      }
    }, ClassReader.SKIP_CODE | ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);

    reader.accept(new ClassVisitor(Opcodes.ASM9) {
      int methodIndex;

      @Override
      public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
        MethodShape method = methods.get(methodIndex++);
        StringBuilder code = new StringBuilder();
        return new MethodVisitor(Opcodes.ASM9) {
          private void token(Object... values) {
            for (Object value : values) {
              code.append(value).append('|');
            }
          }

          @Override
          public void visitInsn(int opcode) {
            token("i", opcode);
          }

          @Override
          public void visitIntInsn(int opcode, int operand) {
            token("ii", opcode, operand);
          }

          @Override
          public void visitVarInsn(int opcode, int varIndex) {
            token("v", opcode, varIndex);
          }

          @Override
          public void visitTypeInsn(int opcode, String type) {
            token("t", opcode, stableType(type));
          }

          @Override
          public void visitFieldInsn(int opcode, String owner, String fieldName, String fieldDescriptor) {
            String member = "?";
            if (owner.equals(className[0])) {
              Integer index = fieldIndexes.get(new MemberKey(fieldName, fieldDescriptor));
              member = "self:" + index;
            } else if (!stableType(owner).equals("?")) {
              member = stableType(owner) + ':' + fieldName;
            }
            token("f", opcode, member, descriptorShape(fieldDescriptor));
          }

          @Override
          public void visitMethodInsn(int opcode, String owner, String calledName, String calledDescriptor, boolean isInterface) {
            String member = "?";
            if (owner.equals(className[0])) {
              Integer index = methodIndexes.get(new MemberKey(calledName, calledDescriptor));
              member = "self:" + index;
            } else if (!stableType(owner).equals("?")) {
              member = stableType(owner) + ':' + calledName;
            }
            token("m", opcode, member, descriptorShape(calledDescriptor), isInterface);
          }

          @Override
          public void visitInvokeDynamicInsn(String invokedName, String invokedDescriptor, Handle bootstrap, Object... arguments) {
            token("d", descriptorShape(invokedDescriptor), constantShape(bootstrap));
            for (Object argument : arguments) {
              token(constantShape(argument));
            }
          }

          @Override
          public void visitJumpInsn(int opcode, Label label) {
            token("j", opcode);
          }

          @Override
          public void visitLdcInsn(Object value) {
            token("l", constantShape(value));
          }

          @Override
          public void visitIincInsn(int varIndex, int increment) {
            token("inc", varIndex, increment);
          }

          @Override
          public void visitTableSwitchInsn(int minimum, int maximum, Label defaultLabel, Label... labels) {
            token("ts", minimum, maximum, labels.length);
          }

          @Override
          public void visitLookupSwitchInsn(Label defaultLabel, int[] keys, Label[] labels) {
            token("ls", Arrays.toString(keys));
          }

          @Override
          public void visitMultiANewArrayInsn(String arrayDescriptor, int dimensions) {
            token("ma", descriptorShape(arrayDescriptor), dimensions);
          }

          @Override
          public void visitTryCatchBlock(Label start, Label end, Label handler, String type) {
            token("tc", stableType(type));
          }

          @Override
          public void visitEnd() {
            method.code = sha256(code.toString().getBytes(StandardCharsets.UTF_8));
          }
        };
      }
    }, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);

    StringBuilder canonical = new StringBuilder();
    canonical.append("class|").append(normalizedAccess(classAccess[0])).append('|')
        .append(stableType(superName[0])).append('|');
    for (String implemented : interfaces) {
      canonical.append("interface|").append(stableType(implemented)).append('|');
    }
    for (FieldShape field : fields) {
      canonical.append("field|").append(normalizedAccess(field.access())).append('|')
          .append(descriptorShape(field.descriptor())).append('|')
          .append(constantShape(field.value())).append('|');
    }
    for (MethodShape method : methods) {
      canonical.append("method|").append(normalizedAccess(method.access)).append('|')
          .append(method.name.equals("<init>") || method.name.equals("<clinit>") ? method.name : "?").append('|')
          .append(descriptorShape(method.descriptor)).append('|').append(method.code).append('|');
    }
    return new ClassShape(
        className[0],
        classAccess[0],
        superName[0],
        List.copyOf(interfaces),
        List.copyOf(fields),
        List.copyOf(methods),
        Map.copyOf(fieldIndexes),
        Map.copyOf(methodIndexes),
        sha256(canonical.toString().getBytes(StandardCharsets.UTF_8)));
  }

  private static Map<String, ClassShape> analyzeAll(Map<String, byte[]> classes) {
    Map<String, ClassShape> result = new TreeMap<>();
    classes.forEach((name, bytes) -> result.put(name, analyze(bytes)));
    return result;
  }

  private static Map<String, ClassMapping> resolve(
      Map<String, ClassShape> source,
      Map<String, ClassShape> target,
      List<String> patchClasses) {
    Map<String, List<ClassShape>> targetsByFingerprint = new HashMap<>();
    for (ClassShape shape : target.values()) {
      targetsByFingerprint.computeIfAbsent(shape.fingerprint, ignored -> new ArrayList<>()).add(shape);
    }

    Map<String, ClassMapping> mappings = new LinkedHashMap<>();
    for (String sourceName : patchClasses) {
      ClassShape sourceShape = source.get(sourceName);
      if (sourceShape == null) {
        throw new IllegalStateException("reference class is missing: " + sourceName);
      }
      List<ClassShape> candidates = targetsByFingerprint.getOrDefault(sourceShape.fingerprint, List.of());
      if (candidates.size() != 1) {
        throw new IllegalStateException(
            "expected one structural target for " + sourceName + " but found " + candidates.size()
                + ": " + candidates.stream().map(candidate -> candidate.name).toList());
      }
      ClassShape targetShape = candidates.getFirst();
      if (sourceShape.fields.size() != targetShape.fields.size()
          || sourceShape.methods.size() != targetShape.methods.size()) {
        throw new IllegalStateException("member count changed for " + sourceName);
      }
      mappings.put(sourceName, new ClassMapping(sourceShape, targetShape));
    }
    return mappings;
  }

  private static String json(String value) {
    return '"' + value
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t") + '"';
  }

  private static void property(StringBuilder output, String name, String value, boolean comma) {
    output.append("    ").append(json(name)).append(": ").append(json(value));
    output.append(comma ? ",\n" : "\n");
  }

  private static void writeMapping(
      Path sourceJar,
      Path targetJar,
      Path outputPath,
      Map<String, ClassMapping> mappings,
      List<Role> roles) throws IOException {
    StringBuilder output = new StringBuilder();
    output.append("{\n  \"schema\": 1,\n");
    output.append("  \"source_sha256\": ").append(json(sha256(sourceJar))).append(",\n");
    output.append("  \"target_sha256\": ").append(json(sha256(targetJar))).append(",\n");
    output.append("  \"classes\": [\n");
    int classNumber = 0;
    for (ClassMapping mapping : mappings.values()) {
      output.append("    {\"source\": ").append(json(mapping.source.name))
          .append(", \"target\": ").append(json(mapping.target.name)).append("}");
      output.append(++classNumber < mappings.size() ? ",\n" : "\n");
    }
    output.append("  ],\n  \"fields\": [\n");
    List<String> fieldObjects = new ArrayList<>();
    for (ClassMapping mapping : mappings.values()) {
      for (int index = 0; index < mapping.source.fields.size(); index++) {
        FieldShape source = mapping.source.fields.get(index);
        FieldShape target = mapping.target.fields.get(index);
        if (!descriptorShape(source.descriptor()).equals(descriptorShape(target.descriptor()))) {
          throw new IllegalStateException("field shape changed at " + mapping.source.name + "#" + index);
        }
        fieldObjects.add("    {\"source_owner\": " + json(mapping.source.name)
            + ", \"source_name\": " + json(source.name())
            + ", \"source_descriptor\": " + json(source.descriptor())
            + ", \"target_owner\": " + json(mapping.target.name)
            + ", \"target_name\": " + json(target.name())
            + ", \"target_descriptor\": " + json(target.descriptor()) + "}");
      }
    }
    output.append(String.join(",\n", fieldObjects)).append('\n');
    output.append("  ],\n  \"methods\": [\n");
    List<String> methodObjects = new ArrayList<>();
    for (ClassMapping mapping : mappings.values()) {
      for (int index = 0; index < mapping.source.methods.size(); index++) {
        MethodShape source = mapping.source.methods.get(index);
        MethodShape target = mapping.target.methods.get(index);
        if (!descriptorShape(source.descriptor).equals(descriptorShape(target.descriptor))
            || !source.code.equals(target.code)) {
          throw new IllegalStateException("method shape changed at " + mapping.source.name + "#" + index);
        }
        methodObjects.add("    {\"source_owner\": " + json(mapping.source.name)
            + ", \"source_name\": " + json(source.name)
            + ", \"source_descriptor\": " + json(source.descriptor)
            + ", \"target_owner\": " + json(mapping.target.name)
            + ", \"target_name\": " + json(target.name)
            + ", \"target_descriptor\": " + json(target.descriptor) + "}");
      }
    }
    output.append(String.join(",\n", methodObjects)).append('\n');
    output.append("  ],\n  \"roles\": [\n");
    List<String> roleObjects = new ArrayList<>();
    for (Role role : roles) {
      ClassMapping owner = mappings.get(role.owner);
      Integer index = owner.source.methodIndexes.get(new MemberKey(role.method, role.descriptor));
      if (index == null) {
        throw new IllegalStateException("reference role method is missing: " + role);
      }
      MethodShape target = owner.target.methods.get(index);
      roleObjects.add("    {\"role\": " + json(role.role)
          + ", \"owner\": " + json(owner.target.name)
          + ", \"method\": " + json(target.name)
          + ", \"descriptor\": " + json(target.descriptor) + "}");
    }
    output.append(String.join(",\n", roleObjects)).append('\n');
    output.append("  ]\n}\n");
    Files.writeString(outputPath, output.toString(), StandardCharsets.UTF_8);
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 4) {
      System.err.println(
          "usage: BitwigSymbolResolver PATCH_SPEC_JSON REFERENCE_JAR TARGET_JAR OUTPUT_JSON");
      System.exit(2);
    }
    PatchSpec spec = readPatchSpec(Path.of(args[0]));
    Path sourceJar = Path.of(args[1]);
    Path targetJar = Path.of(args[2]);
    String sourceSha256 = sha256(sourceJar);
    if (!sourceSha256.equals(spec.referenceSha256)) {
      throw new IllegalStateException(
          "patch specification targets reference " + spec.referenceSha256
              + " but reference JAR is " + sourceSha256);
    }
    Map<String, ClassShape> source = analyzeAll(readClasses(sourceJar));
    Map<String, ClassShape> target = analyzeAll(readClasses(targetJar));
    writeMapping(
        sourceJar,
        targetJar,
        Path.of(args[3]),
        resolve(source, target, spec.classes),
        spec.roles);
  }
}
