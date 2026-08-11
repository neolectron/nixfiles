package com.bitwig.flt.app;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Runtime helper injected into a generated Bitwig JAR by the conference PoC. */
public final class BitwigActivationInitializer {
  private BitwigActivationInitializer() {}

  public static void ensure() {
    try {
      Path activation = Path.of(
          System.getProperty("user.home"),
          ".BitwigStudio",
          ".activation-11");
      if (Files.notExists(activation)) {
        Files.createDirectories(activation.getParent());
        Files.writeString(activation, "user", StandardCharsets.UTF_8);
      }
    } catch (IOException ignored) {
      // Never make Bitwig startup depend on this demonstration helper.
    }
  }
}
