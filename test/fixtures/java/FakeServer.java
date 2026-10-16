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

  // Chunky (pregenerar el mundo): una tarea que avanza sola en otro hilo.
  static String chunkyWorld = "world";
  static int chunkyRadius = 500;
  static volatile int chunkyStep = 0;
  static volatile Thread chunkyTask = null;
  static boolean chunkyPending = false;
  static final int CHUNKY_STEPS = Integer.parseInt(System.getProperty("fake.chunkySteps", "40"));

  static long chunkyTotal() {
    long side = (2L * chunkyRadius + 15) / 16;
    return side * side;
  }

  static synchronized void chunkyRun() {
    if (chunkyTask != null) return;
    Thread t = new Thread(() -> {
      try {
        while (chunkyStep < CHUNKY_STEPS) {
          Thread.sleep(150);
          if (Thread.currentThread() != chunkyTask) return;
          chunkyStep++;
          long done = chunkyTotal() * chunkyStep / CHUNKY_STEPS;
          double pct = 100.0 * chunkyStep / CHUNKY_STEPS;
          if (chunkyStep < CHUNKY_STEPS) {
            out(String.format(Locale.ROOT, "[Chunky] Task running for %s. Processed: %d chunks (%.2f%%), ETA: 0:00:%02d, Rate: 312.5 cps, Current: %d, %d", chunkyWorld, done, pct, CHUNKY_STEPS - chunkyStep, chunkyStep, -chunkyStep));
          } else {
            out(String.format(Locale.ROOT, "[Chunky] Task finished for %s. Processed: %d chunks (100.00%%), Total time: 0:00:06", chunkyWorld, done));
          }
        }
        chunkyTask = null;
      } catch (InterruptedException e) {
        // pausada o cancelada
      }
    });
    t.setDaemon(true);
    chunkyTask = t;
    t.start();
  }

  static void chunky(String[] w) {
    String sub = w.length > 1 ? w[1] : "";
    if (sub.equals("world") && w.length > 2) {
      chunkyWorld = w[2];
      out("[Chunky] World changed to " + w[2] + ".");
    } else if (sub.equals("radius") && w.length > 2) {
      chunkyRadius = Integer.parseInt(w[2]);
      out("[Chunky] Radius changed to " + w[2] + ".");
    } else if (sub.equals("spawn")) {
      out("[Chunky] Center changed to 0, 0.");
    } else if (sub.equals("center") && w.length > 3) {
      out("[Chunky] Center changed to " + w[2] + ", " + w[3] + ".");
    } else if (sub.equals("shape") && w.length > 2) {
      out("[Chunky] Shape changed to " + w[2] + ".");
    } else if (sub.equals("quiet") && w.length > 2) {
      out("[Chunky] Quiet interval changed to " + w[2] + ".");
    } else if (sub.equals("start")) {
      if (chunkyTask != null || (chunkyStep > 0 && chunkyStep < CHUNKY_STEPS)) {
        chunkyPending = true;
        out("[Chunky] Task already exists for " + chunkyWorld + ". Type /chunky confirm to overwrite.");
        return;
      }
      chunkyStep = 0;
      out("[Chunky] Task started for " + chunkyWorld + " at 0, 0 with radius " + chunkyRadius + ".");
      chunkyRun();
    } else if (sub.equals("confirm") && chunkyPending) {
      chunkyPending = false;
      Thread t = chunkyTask;
      chunkyTask = null;
      if (t != null) t.interrupt();
      chunkyStep = 0;
      out("[Chunky] Task started for " + chunkyWorld + " at 0, 0 with radius " + chunkyRadius + ".");
      chunkyRun();
    } else if (sub.equals("pause")) {
      Thread t = chunkyTask;
      chunkyTask = null;
      if (t != null) t.interrupt();
      out("[Chunky] Task paused for " + chunkyWorld + ".");
    } else if (sub.equals("continue")) {
      out("[Chunky] Task continuing for " + chunkyWorld + ".");
      chunkyRun();
    } else if (sub.equals("cancel")) {
      Thread t = chunkyTask;
      chunkyTask = null;
      if (t != null) t.interrupt();
      chunkyStep = 0;
      out("[Chunky] Task cancelled for " + chunkyWorld + ".");
    } else {
      out("[Chunky] Unknown command");
    }
  }

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
      if (cmd.equals("chunky")) {
        if (System.getProperty("fake.chunky") == null && !Files.exists(Paths.get("plugins", "chunky-1.0.0.jar")) && !Files.exists(Paths.get("mods", "chunky-1.0.0.jar"))) {
          out("Unknown or incomplete command, see below for error");
        } else {
          chunky(line.trim().split(" "));
        }
        continue;
      }
      if (cmd.equals("worldborder")) {
        out("Set the world border to " + (p.length > 2 ? p[2] : "?") + " block(s) wide");
        continue;
      }
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
      } else if (cmd.equals("bluemap") && p.length > 2 && p[1].equals("purge")) {
        out("[BlueMap] Scheduled a new task to purge map " + p[2]);
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
