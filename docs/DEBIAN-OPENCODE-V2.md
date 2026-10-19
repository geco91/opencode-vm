# Debian und OpenCode V2: gemeinsamer Entwicklungsplan

Stand: 2026-10-19. Entwicklungsbranch: `feat/debian-opencode-v2`.
Ausgangscommit: `8305ae90d5bd9a8140fdf850425d5565f53d4bef` (OCVM 0.7.70).

## Auftrag und Quellen

Debian zusätzlich zu macOS als Lima-Host unterstützen und den bestehenden
OCVM-Funktionsumfang auf OpenCode Backend V2 portieren. Entwicklung und
Vorprüfungen erfolgen in der Cloud; vollständige Debian-Integration später auf
`testproxmox` über die BI-MC-Verbindung. Eine eigene Debian-Test-VM verwenden;
bestehende BI-MC-Tests, VMs und Baselines bleiben erhalten. Aktuelle Belegung,
Ressourcen, Zielidentität und Nested KVM vor dem Aufbau prüfen.

Die am 18. Oktober vollständig gelesenen kanonischen Ticketpläne bleiben die
fachlichen Quellen; diese Datei ist der gemeinsame Umsetzungsstand des Branches:

- V2: `task_2a0c9147-335a-5ffd-bcd0-e792fa97630a`,
  `planning/task-concepts/task_2a0c9147-335a-5ffd-bcd0-e792fa97630a-concept-plan.md`,
  Kontext `.opencode/tasks/task-task_2a0c9147-335a-5ffd-bcd0-e792fa97630a.compact.md`.
- Debian: `task_8cf320c8-eeac-557a-9b0c-2bc66523daa6`,
  `planning/task-concepts/task_8cf320c8-eeac-557a-9b0c-2bc66523daa6-concept-plan.md`,
  Kontext `.opencode/tasks/task-task_8cf320c8-eeac-557a-9b0c-2bc66523daa6.compact.md`.

Die über MCP verfügbaren Ticketdateien müssen nicht im öffentlichen Checkout
vorhanden sein. Ihre Registrierung und der Boardstatus werden durch lokale
Branchänderungen nicht geändert. Historische Versions-/Zeilenangaben aus den
Plänen werden am aktuellen Checkout erneut geprüft.

## Reihenfolge und Abnahme

1. **Debian-Portabilität bei bisherigem Backend.** BSD/GNU-Hashing, mtimes,
   Dateibearbeitung, IP-Ermittlung, VS-Code-Pfade und Installationshinweise
   angleichen. macOS bleibt bei vz/virtiofs; Debian verwendet QEMU/KVM und
   zunächst 9p. Kein TCG als erfolgreicher Betriebsnachweis. Bash 3.2 erhalten.
2. **V2-Isolation.** Branchskript direkt verwenden; stabilen Launcher nicht
   überschreiben. Eigenen Configroot, Share-/State-/Auth-Namensraum und Base-VM
   vorsehen. V2-Globalsync zunächst aussetzen. Erst Koexistenz bei identischem
   Backend nachweisen, danach echte Runtime umstellen. Kein verpflichtendes
   anderes HOME. V1-Konfiguration und V1-Datenstand bleiben erhalten.
3. **Versionierter Backendport.** CLI, Server, SDK und Policyplugin anhand
   derselben verifizierten V2-Version migrieren. Session-/Nachrichten-/Receipt-
   Zuordnung, Pagination, Fehler, Abbruch, Runtimewahl, Policyadoption,
   Journalzustände/Events/Attention, Hub, MCP, A2A und OpenLive prüfen.
   Ein SDK-Importpfad mit `/v2` beweist keine Produkt-V2-Kompatibilität.
4. **Cloud-Abnahme.** Gezielte Hostprüfungen, Syntax-/Typprüfung, Builds und
   native V2-API-Proben mit ausschließlich temporären eigenen Daten. Kein
   allgemeines neues Test-/CI-System. Modell-/Provider-Smokes nur gezielt;
   keine Geheimnisse oder Promptinhalte als Diagnosebelege speichern.
5. **Reale Plattformabnahme.** Auf testproxmox eine eigene Debian-VM, darin
   Lima/QEMU mit nachgewiesener KVM-Beschleunigung. Kleines separates Repo
   (AITL bevorzugt), Lesen/Schreiben, Git, zusätzlicher Worktree, Rechte,
   Symlinks, Locks/Notifications, Session, Web/MCP, mehrere echte Monitortakte,
   Stop/Start/Re-Attach. macOS-Regression auf einem echten Mac getrennt prüfen.
6. **Übergabe.** Reproduzierbare Versionen/Artefakte, Installationsschritte,
   Testbelege und Rollback dokumentieren. V2-Daten nur nach bewiesener
   Formatkompatibilität wieder mit V1 öffnen; sonst separaten V1-Stand nutzen.
   Gemeinsamer PR erst mit ehrlichen Plattform-Abnahmeständen.

Neue V2-Funktionen nur sammeln, nicht in den Bestandsport hineinziehen.
LMStudio-Discovery versionsgenau berücksichtigen; Inference, Toolcalling und
Hostnetzroute benötigen einen echten erreichbaren Server. Ein kurzer Smoke-PASS
ist weder Lastnachweis noch ENFILE-Fix. Größere Lasttests und die separate
ENFILE-Diagnostik bleiben eigene Arbeitsschritte.

## Isolierter V2-Modus

```bash
OCVM_EXPERIMENT=v2 bash /pfad/zum/branch/opencode-vm.sh --version
```

Dieser Modus installiert und verwendet OpenCode **2.0.32**. Er trennt
`~/.opencode-vm-v2/`, dessen `global/{config,data,state}/opencode`,
`~/.opencode-vm-v2/lima` und `oc-base-v2` von den stabilen Pfaden.
`install`, `update` und OpenLive-Hostsetup sind in diesem Modus gesperrt.
Immer denselben Modus und einen separaten Testcheckout verwenden. Es findet
keine automatische Übernahme von V1-Config oder Credentials statt.
Globale Experimentkonfiguration wird nur einmal in neue Projektkonfiguration
übernommen; danach bleibt die Konfiguration projektlokal. Kleine Hosts können
für `init` `OCVM_BASE_CPUS=2 OCVM_BASE_MEMORY_GIB=2` setzen; die Werte werden
vor dem Entfernen einer bestehenden Base gegen den Host validiert.

Die native CLI läuft als eigener `serve`-Prozess. Die interne Loopbackbrücke
übersetzt die bestehenden OCVM-Adapterverträge; Web UI und native TUI verwenden
die V2-API. Der bisherige SDK-Pin bleibt dafür ein interner OCVM-Client, kein
V2-Backendnachweis. Das Policyplugin verwendet echte V2-Hooks und den bisherigen
gemeinsamen Policybesitzer für MCP/A2A/OpenLive.

Die CLI aktiviert in dieser Version keine Event-Payload-Retention. OCVM hält
deshalb beobachtete native Enqueue-Typen und Delivery-/Step-IDs samt Sequenz
projektlokal fest. Interne Kompaktierungs-/Kontextnachrichten ersetzen dabei
keine Benutzer-ID. Frühere untypisierte Experimentdatensätze werden beim
Weiterbetrieb als unbekannte Zuordnung behandelt.
Lücken und mehrere gemeinsame Deliveries bleiben unzugeordnet; Text-/Zeitnähe
begründet keinen Parent und keine automatische Wiederholung eines Auftrags.
Archivierung nutzt mangels nativer Archive-Update-API ein OCVM-Metadatum; die
OCVM-Adapter berücksichtigen es, die native Web UI hat damit keine zusätzliche
Archivfunktion. Aktuelle Credentials werden bei Finalisierung aus der gepinnten
nativen Datenbank ausschließlich lesend gesichert und bei frischer Historie
getrennt wiederhergestellt. V1-Credentials werden nicht importiert. Die alte
`auth.json` ist in V2 kein Credential-Speicher: eine leere Kompatibilitätsdatei
darf den Resume nicht von einem bereits geleerten Gast-`/tmp` abhängig machen.
Bei gestoppter V2-VM ist dies nur mit nachgewiesen leerer Legacy-Baseline
zulässig; V1 behält seine bisherige Snapshot-Sperre.

## Verifizierter Stand

- Cloud: Debian 13.6, x86_64; kein `/dev/kvm` in dieser Cloudumgebung.
- Aktueller Code: gast-native Worktrees sind bereits vorhanden. Ihre bestehende
  Persistenz-/Ownership-Grenze wird nicht neu erfunden.
- npm am 18. Oktober: `@opencode/cli` und `@opencode/client` jeweils 2.0.32.
  Quelltag `v2.0.32`: `843a6c514e606b436a7fe713422ace0a93ad3d61`.
  CLI-/Client-Tarballs und Linux-x64-Binary anhand npm-SHA512 geprüft.
- Isolierte Binary meldet `opencode v2.0.32`. Native API-/Plugin-Smokes laufen
  mit eigenen temporären Daten und einem lokalen synthetischen Modellserver;
  keine externen Modellanfragen oder übernommenen Provider-Credentials.
- V2 verwendet `serve`, den Client `@opencode/client`, `/api/...` und eine neue
  Plugin-API. Ein alter `/global/health`-Abruf liefert sogar HTML mit HTTP 200;
  HTTP-Erfolg allein ist deshalb keine Backend-Healthprüfung.
- MCP: native Session-Erzeugung, Policyadoption, Prompt und vollständiges
  korrekt zugeordnetes Ergebnis PASS. Ergebnis nach Serverneustart erneut PASS.
- Completion-Gate: synthetischer Question-Toolcall endet als gespeicherter
  `INPUT_REQUIRED`-Bericht ohne nativen Dialog; Usage bleibt erhalten.
- OpenLive: nativer Sessiontool-Pluginstart, Tool-/Manager-Rechteprüfung und
  vollständiger synchroner Prompt über den bestehenden Gateway PASS. Keine
  Aussage über echte Voice-/Desktop-Abnahme.
- Debian-Helperproben: projektnamensgleiches MD5, Dateimtime und YAML-Einfügung
  mit erhaltenem Modus 0600 PASS. Fehlendes KVM wird vor Base-Neuaufbau erkannt.
- Bash-Syntax, ShellCheck Fehlerstufe und Vergleich mit dem unveränderten
  Ausgangsskript PASS (keine neuen ShellCheck-Muster). MCP-Typecheck PASS;
  deterministischer eingebetteter Managed-Runtime-Payload wird mitgebaut.
- Zusätzliche gezielte Proben PASS: Hashing von Dateinamen mit Backslash,
  ungültige/symlinkbasierte YAML-Dateien bleiben unverändert, keine Lima-Aufrufe
  vor KVM-Fehler, Experiment-Globalsync bleibt aus, OpenLive-Hostsetup gesperrt.
  Der BSD-mtime-Zweig wurde mit einem Befehlsstub geprüft; kein echter Maclauf.
- testproxmox: ursprünglichen Auftrag abgeglichen, danach eine eigene Debian
  13 VM angelegt. Lima 2.2.1 (offizielles Release, SHA-256 geprüft), QEMU/KVM,
  9p und verschachtelte KVM-Beschleunigung bis zum Lima-Gast belegt. OVMF war
  erforderlich. Ein Einfrieren der eigenen VM trat auf; nach eigenem Neustart
  und kleinerer Lima-Speichergröße funktionierte der Smoke. Ursache offen,
  kein Last-/Stabilitätsnachweis; fremde Ressourcen laut Abschlussprüfung
  unverändert. Private Verbindungsdaten bleiben außerhalb dieses Repos.
- Weitere Cloud-Proben mit echtem V2-Backend PASS: wartende Benutzeraufträge
  bleiben `submitted` und lesbar; zwei Aufträge erhalten getrennte exakte
  Endergebnisse; Abbruch bleibt `aborted`. Modellvorgabe samt Variante,
  Umbenennen und OCVM-Archivierung sind geprüft. Bildanhang über den echten
  MCP-HTTP-Upload und die native URI-Admission PASS; Materialisierung der
  gespeicherten V2-Datei und V1-FilePart-Regression PASS.
- Native Credentials: synthetischen Key sichern (0600), rein lesend aus SQLite
  checkpointen, in frische leere Sitzungsdatenbank wiederherstellen und Logout
  in der Sicherung nachweisen PASS. Keine realen Zugangsdaten verwendet.
- Richtlinien: Read-Ask wird mit genau einer lokalen Modellanfrage als
  `INPUT_REQUIRED` beendet, ohne offene Dialoge. Explizit freigegebene externe
  Einzeldatei wird vom nativen Read-Tool gelesen. A2A mit tatsächlichem
  Client 1.2.0 (Erzeugen/Adoption/synchroner Prompt) PASS. Providerstatus und
  Doctor erkennen den Wrapper samt authentifiziertem echten Backend.
- CLI-Probe am 19. Oktober PASS: äußerer No-Auth-Modus mit privatem nativen
  Passwort, Wiederverwendung des Servers durch `models` und Ende des nativen
  Daemons bei hartem Supervisorende. CLI-Serverflag steht hinter dem Befehl.
- Vollständiger Debian-Lauf auf Basis `b52855c` mit lokalem Diagnosefix:
  Base-Init zweimal exit 0, echte Session mit KVM/9p, bidirektionale Dateien,
  Modus 0600, Symlink, Git und zusätzlicher Worktree ohne Originzugriff;
  Web-Bootstrap, `--no-mcp`-Abgrenzung, MCP-Initialisierung/Reads, lokaler
  Mock-Modellaufruf und Stop/Resume belegt. Kein unveränderter Gesamt-PASS:
  DNS war zunächst blockiert und Resume erforderte Diagnoseeingriffe.
- Daraus korrigiert: QEMU/LIMADNS schreibt DNS `.3:53` auf einen dynamischen
  Hostresolver-Port um. Die Regel berücksichtigt ausschließlich dieses
  ursprüngliche DNS-Ziel; sonst bleiben Host-Port- und LAN-Sperren erhalten.
  Die Base muss für die Firewalländerung neu provisioniert werden.
  Editor-Stop-Ausgaben gehen bei Auth-Capture nach stderr, damit die
  gesicherte Datei ausschließlich JSON enthält. V2-Resume hängt nicht mehr
  an der nicht verwendeten alten Authdatei. Gezielte lokale Capture-/Baseline-
  Proben einschließlich unverändertem V1-Fail-Closed PASS.
- Noch offen: erneuter vollständiger Debian-Lauf des korrigierten Stands,
  native Session-Exposition nach Resume und erfolgreicher Monitor-Dispatch
  (bisher nur echte Takte, aber `CREATION_UNCERTAIN`/Registry-Lock-Probleme).
  Der Mock benötigt eine korrekt konfigurierte native Modell-Kontextgröße;
  `contextWindow:null` aus dem ersten Fixture ist kein Lastnachweis.
  Ein echter macOS-VM-Lauf und LMStudio-Inference bleiben separat offen.

## Umfang der nativen Brücke

Die geprüften OCVM-Sitzungs-, MCP-, A2A- und OpenLive-Kernpfade verwenden
OpenCode 2.0.32. Alte zusätzliche REST-Aktionen ohne implementierte native
Zuordnung (etwa V1-Shell-/Command-/Todo-/Share-Routen) liefern explizit einen
Fehler. Das ist keine vollständige V1-REST-API-Emulation. Native Web-/TUI-
Funktionen verwenden unmittelbar V2. Eine allgemeine Funktionsparität oder
Releasefreigabe ist mit den noch offenen Abnahmen nicht belegt.

## Offizielle versionsgebundene Quellen

- <https://github.com/anomalyco/opencode/tree/v2.0.32>
- `services/www/src/docs/content/migrate-v1.mdx`
- `services/www/src/docs/content/build/plugins/migrate-v1.mdx`
- `packages/client/`, `packages/schema/`, `packages/plugin/`, `packages/server/`
- <https://registry.npmjs.org/@opencode%2fcli/2.0.32>
- <https://registry.npmjs.org/@opencode%2fclient/2.0.32>
- <https://lima-vm.io/docs/config/vmtype/qemu/>
- <https://lima-vm.io/docs/config/mount/>
- <https://docs.kernel.org/virt/kvm/x86/running-nested-guests.html>
