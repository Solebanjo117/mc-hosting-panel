import java.nio.charset.StandardCharsets;
import java.nio.file.*;

/**
 * Instalador falso de Forge/NeoForge: con --installServer crea el archivo de argumentos
 * (unix_args.txt / win_args.txt) que el panel busca, apuntando a FakeServer dentro de este mismo jar.
 */
public class FakeInstaller {
  public static void main(String[] args) throws Exception {
    boolean install = false;
    for (String a : args) if (a.equals("--installServer")) install = true;
    if (!install) {
      System.out.println("Usa --installServer");
      System.exit(2);
    }
    Path self = Paths.get(FakeInstaller.class.getProtectionDomain().getCodeSource().getLocation().toURI());
    // El panel guarda el instalador como installer.jar: se usa una carpeta de versión fija.
    Path dir = Paths.get("libraries/net/minecraftforge/forge/fake");
    Files.createDirectories(dir);
    Path lib = Paths.get("libraries/fake/server.jar");
    Files.createDirectories(lib.getParent());
    Files.copy(self, lib, StandardCopyOption.REPLACE_EXISTING);
    byte[] argsFile = "-cp libraries/fake/server.jar FakeServer\n".getBytes(StandardCharsets.UTF_8);
    Files.write(dir.resolve("unix_args.txt"), argsFile);
    Files.write(dir.resolve("win_args.txt"), argsFile);
    System.out.println("Installing libraries... done");
    System.out.println("The server installed successfully");
  }
}
