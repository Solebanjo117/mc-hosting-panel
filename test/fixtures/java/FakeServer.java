import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * Servidor de Minecraft falso para las pruebas del panel. Imprime lo mismo que un servidor real
 * en los momentos clave (arranque, "Done", entradas y salidas, guardado, TPS, caída) y responde
 * a algunos comandos. Compatible con Java 8.
 */
public class FakeServer {
  static final Set<String> players = new LinkedHashSet<>();

  static void out(String s) {
    System.out.println("[12:00:00 INFO]: " + s);
    System.out.flush();
  }

  public static void main(String[] args) throws Exception {
    String level = "world";
    Path props = Paths.get("server.properties");
    if (Files.exists(props)) {
      for (String line : Files.readAllLines(props, StandardCharsets.ISO_8859_1)) {
        if (line.startsWith("level-name=")) level = line.substring(11).trim();
      }
    }
    Files.createDirectories(Paths.get(level, "region"));
    Path ld = Paths.get(level, "level.dat");
    if (!Files.exists(ld)) Files.write(ld, new byte[] { 10, 0, 0, 0 }); // compuesto NBT vacío sin comprimir
    out("Starting minecraft server version " + System.getProperty("fake.version", "1.21.4"));
    if (System.getenv("FAKE_SLOW_START") != null) Thread.sleep(Long.parseLong(System.getenv("FAKE_SLOW_START")));
    out("Done (0.123s)! For help, type \"help\"");

    BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    String line;
    while ((line = in.readLine()) != null) {
      String[] p = line.trim().split(" ", 3);
      String cmd = p[0];
      if (cmd.equals("stop")) {
        out("Stopping the server");
        System.exit(0);
      } else if (cmd.equals("list")) {
        out("There are " + players.size() + " of a max of 20 players online: " + String.join(", ", players));
      } else if (cmd.equals("join") && p.length > 1) {
        players.add(p[1]);
        out(p[1] + "[/" + (p.length > 2 ? p[2] : "127.0.0.1") + ":5000] logged in with entity id 1 at (0, 64, 0)");
        out(p[1] + " joined the game");
      } else if (cmd.equals("leave") && p.length > 1) {
        players.remove(p[1]);
        out(p[1] + " left the game");
      } else if (cmd.equals("chat") && p.length > 2) {
        out("<" + p[1] + "> " + p[2]);
      } else if (cmd.startsWith("save-all")) {
        out("Saving the game (this may take a moment!)");
        out("Saved the game");
      } else if (cmd.equals("save-off")) {
        out("Automatic saving is now disabled");
      } else if (cmd.equals("save-on")) {
        out("Automatic saving is now enabled");
      } else if (cmd.equals("reload") || cmd.equals("minecraft:reload")) {
        out("Reloading!");
      } else if (cmd.equals("tps")) {
        out("TPS from last 1m, 5m, 15m: 19.5, 20.0, 20.0");
      } else if (cmd.equals("crash")) {
        System.out.println("java.lang.OutOfMemoryError: Java heap space");
        System.out.flush();
        System.exit(1);
      } else if (cmd.equals("flood") && p.length > 1) {
        int n = Integer.parseInt(p[1]);
        for (int i = 0; i < n; i++) out("Bot" + i + "[/45.1." + (i % 250) + ".7:5000] logged in with entity id " + i + " at (0, 64, 0)");
      } else if (cmd.equals("say") && p.length > 1) {
        out("[Server] " + line.substring(4));
      } else if (cmd.equals("args")) {
        // Muestra los argumentos de Java con los que arrancó (para probar la optimización).
        out("JVM " + String.join(" ", java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments()));
      } else {
        out("cmd " + line);
      }
    }
  }
}
