# Debian und OpenCode V2: gemeinsamer Entwicklungsplan

Stand: 2026-10-19. Entwicklungsbranch: `feat/debian-opencode-v2`.
Ausgangscommit: `8305ae90d5bd9a8140fdf850425d5565f53d4bef` (OCVM 0.7.70).

Aktueller Prüfstand: OCVM **0.7.86**, MCP **0.1.68**, OpenLive **0.1.9**,
OpenCode **2.0.32**. Die folgenden historischen Befunde dokumentieren auch
fehlgeschlagene Zwischenstände; sie sind keine Freigabe des aktuellen Branches.

| Abnahmepunkt | Cloud | Reales Debian auf testproxmox |
| --- | --- | --- |
| Native V2-API, Policy, MCP, A2A und OpenLive-Gateway | PASS mit echter Binary und lokalem Mock | Web/MCP und exaktes Sitzungsergebnis belegt; übrige native Verträge gezielt in der Cloud geprüft |
| Kalter Start und Gast-Worktree über MCP | Syntax/Build/Verträge PASS | PASS mit 0.7.81, ohne manuelles Vorwärmen |
| Monitor mit Priming und weiterem Wake | PASS mit nativen Hooks, Taskboard und unveränderter Engine, auch mit 0.1.68 | Offen: `create_monitor` mit 0.1.68 bestätigt; `trigger_monitor` liefert internen Fehler, kein Dispatch nachgewiesen. Offener Engine-Wake wird eingegrenzt |
| Historie und Key nach vollständigem Restore | PASS mit identischen IDs und Ergebnishash, ohne neue Inference | PASS mit 0.7.84 nach echtem Boot-Wechsel und geleertem Gast-`/tmp`; 0.7.82 bleibt historischer FAIL |
| Taskboard lesen und schreiben | PASS mit tatsächlichem Taskboard 0.6.0 | PASS: vorhandenes Ticket und genau ein neuer Schreibzugriff nach Neuboot |
| Nichtinteraktive Hostaufrufe behalten nachfolgende stdin-Kommandos | Vorher-/Nachher-Probe PASS mit Bash 5 und 3.2.57 | PASS mit 0.7.84: tatsächliche native Live-Liste und folgende Markerzeile aus stdin-gespeistem Hostskript |
| OAuth-Logout bewahrt unabhängigen Key | PASS mit synthetischen Credentials | PASS: Hostwrapper-Dryrun/Logout, native DB und dauerhafter Snapshot |
| 9p-Dateien, Rechte, Symlinks, Git und Worktree | Keine VM-Abnahme möglich | Dateipfade PASS; `flock` gastlokal exklusiv, über Host/Gast nicht exklusiv. Host-inotify bei Gast-Write belegt; im Gast bei Host-Write binnen 5 s kein Event. FD-Basiswerte erfasst |
| macOS/VZ/virtiofs | Bash-3.2.57-Kompatibilität geprüft | Echter Maclauf offen |

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
zulässig und benötigt zusätzlich einen gültigen privaten nativen Snapshot.
V1 behält seine bisherige Snapshot-Sperre. Native Credential-Events schreiben
die Sicherung unmittelbar sowohl gastlokal als auch in den dauerhaften
Projektshare (0600), nicht erst beim sauberen Ende. Wiederherstellung erfolgt
nur bei tatsächlich neuer nativer Datenbank; eine bestehende leere Datenbank
bewahrt ein ausdrückliches Logout auch gegenüber einem veralteten Snapshot.
Der dauerhafte Snapshot wird vor einer gastlokalen Kopie gelesen, sodass
ein frisches Gast-`/tmp` keine manuelle Vorabkopie benötigt.

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
- Zusätzliche Crash-Probe am 19. Oktober PASS: nativen synthetischen Key
  anlegen, unmittelbaren dauerhaften Snapshot prüfen, Supervisor hart beenden,
  native DB vollständig verwerfen, nur den Snapshot übernehmen, Key in der
  frischen DB wiederfinden und Logout unmittelbar dauerhaft sichern.
  Stopped-Resume ohne gültigen privaten Snapshot bleibt gesperrt. Ein weiterer
  echter API-Smoke bestätigt: bestehendes natives Logout gewinnt auch bei
  absichtlich veralteten lokalen und dauerhaften Sicherungen; frische DBs
  restaurieren direkt aus dem Share ohne manuellen Gast-Seed. Eine beschädigte
  Sicherung stoppt den Start mit einem inhaltsfreien Fehlercode (geprüft).
- Bash 3.2.57 auf Linux aus offiziellen GNU-Quellen gebaut: vollständige
  Skriptsyntax und Versionsaufruf in Standard-/V2-Modus PASS. Dies prüft die
  Shell-Kompatibilität, nicht VZ/virtiofs oder die macOS-VM-Laufzeit.
- Native Fehlerproben am 19. Oktober PASS: eigener HTTP401 wird exakt als
  `provider_auth`, HTTP429 mit ausdrücklichem `insufficient_quota` als
  `provider_quota` erkannt; Rohfehlertexte werden redigiert. Header-/Daten-
  Timeouts des nativen HTTP-Clients ergeben `provider_timeout`. Produkt2.0.32
  verliert beim Speichern seinen internen `Timeout`-Code; die Brücke erkennt
  ausschließlich die zwei nachgewiesenen festen Erzeugertexte zusammen mit
  dem nativen Fehlertyp `provider.transport`, ohne Status oder Dauer zu
  erfinden. Ein gewöhnlicher Verbindungsabbruch bleibt `provider_error`
  (für diese terminale Gegenprobe native Wiederholungen nur im temporären
  Fixture begrenzt). Native Wiederholungen vor einem Endergebnis bleiben
  Arbeitszustände; bloße Aktivität beweist keinen Abschluss.
- CLI-Start auch über die tatsächlich mit npm installierte `.bin/opencode`
  geprüft: Postinstall setzt einen nativen ELF-Einstieg ein. Server-PID,
  CLI-Wiederverwendung, Parent-Death, Credential-Restore/Logout und geschützte
  Ablehnung beschädigter Sicherungen funktionieren ebenso wie beim direkten
  nativen Binary. `--version` erzeugt keine native Datenbank.
- Der reale Gast-Worktree-Test deckte einen fehlenden optionalen
  `worktree_path` im strengen MCP-Ausgabeschema auf: Sitzung und Worktree
  entstanden korrekt, die RPC-Antwort wurde danach als ungültig verworfen.
  Das Schema ist nun an den vorhandenen Rückgabetyp angeglichen. Die erzeugte
  Sitzung wurde im Test ohne erneute Erzeugung über ihre ID weiter geprüft;
  Prompt und vollständiger exakt zugeordneter Originaltext sind belegt.
  Der spätere frische Lauf mit 0.7.81 bestätigt auch die korrigierte
  RPC-Antwort samt `worktree_path`.
- Noch offen: erneuter vollständiger Debian-Lauf des korrigierten Stands,
  native Session-Exposition nach Resume und erfolgreicher Monitor-Dispatch
  (bisher nur echte Takte, aber `CREATION_UNCERTAIN`/Registry-Lock-Probleme).
  Der Mock benötigt eine korrekt konfigurierte native Modell-Kontextgröße;
  `contextWindow:null` aus dem ersten Fixture ist kein Lastnachweis.
- Der kalte Debian-Quellbuild überschritt das bisher schon während `npm`
  laufende Host-Bereitschaftsfenster. Der Host wartet jetzt begrenzt auf die
  vorbereitete Runtime derselben Generation (bis zehn Minuten) und beginnt
  danach seine bisherigen 150 Sekunden für Listener und authentifizierte
  Healthprüfung. Veraltete Runtime-/Ready-Dateien gelten nicht als Nachweis.
  Gezielte beschleunigte Ablaufproben mit Bash 5 und 3.2.57 prüfen langsame
  Vorbereitung, veraltete Generation, fehlenden Listener, falsche Health-
  Generation und Abbruch. Der kalte reale Debian-Lauf mit 0.7.81 bestand
  anschließend ohne manuelles Vorwärmen nach etwa sechseinhalb Minuten.
- Beim anschließenden Stop/Attach hielten zurückgebliebene Proxy-, OpenLive-
  und A2A-Hilfsprozesse den geerbten Runtime-Lock offen. Ihre Supervisoren und
  der A2A-Bereitschaftsbeobachter schließen jetzt FD 9 beim Start, ebenso wie
  bereits der MCP-Supervisor. Ein gezielter Vorher-/Nachher-Lauf mit echten
  Hilfsprozessen und eigenen Dummy-Diensten bestätigt: Der Controller hält
  seine Sperre weiter; nach dessen Ende blockieren die weiterlebenden Helfer
  sie nicht mehr. Native Schreiber- und Ownership-Prüfungen bleiben erhalten.
  Der reale Capture/Takeover-/Re-Attach mit 0.7.81 erreichte anschließend
  wieder vollständige MCP-Bereitschaft ohne manuell getötete Helfer oder
  Auth-Seeds. Der vorherige Host-Stop endete mit Exit 1; das belegt keinen
  normalen Stop und keinen VM-Neuboot mit wiederhergestellter Historie.
  Ein echter macOS-VM-Lauf und LMStudio-Inference bleiben separat offen.
- Provider-Schreibbefehle verwenden im Experiment jetzt native
  `providers`/`package`/`settings`/`capabilities` statt V1-Config und `auth.json`.
  Sie bearbeiten die isolierte Vorlage für neue Projektkonfigurationen.
  Bestehende Projekte behalten bei ausgeschaltetem Globalsync ihre eigene
  native Web-UI-Konfiguration. Dadurch kann keine alte Sitzungsconfig eine
  nebenläufig bearbeitete Projektconfig wieder überschreiben.
  JSON und Sicherungen bleiben privat (0600). Add/Dry-run, Modellkatalog-Sync,
  Erhalt expliziter Capabilities und Limits sowie Entfernen sind gegen den
  tatsächlichen npm-Einstieg von OpenCode 2.0.32 geprüft. Fehlerhafte Kataloge
  lassen die Config unverändert. `subscription rm` entfernt native OAuth-
  Konten der Integration in der laufenden Projektsitzung und prüft den
  dauerhaften Logout; andere Keys bleiben erhalten. Dieser echte API-Smoke
  verwendet synthetische Credentials und keine Inference-Anfragen.
- Monitor und Dashboard übernehmen jetzt ebenfalls den gemeinsamen
  Adapter-Header und die projektbezogene Server-Authentifizierung. Der
  bisherige eigene Monitor-Client authentifizierte sich nicht; unmarkierte
  Clients erhielten außerdem keine Projektion der OCVM-Archivmetadaten.
  Gegen die echte V2-Runtime reproduziert und korrigiert: Zugriff bei
  aktivierter Authentifizierung funktioniert, archivierte Sitzungen bleiben
  für beide Clients verborgen. Ohne Markierung fehlte auch die native
  Question-/Form-Zuordnung: Pending-Input blieb unbekannt und verhinderte
  neue Aufträge. Mit dem gemeinsamen Client ist die Abdeckung wieder
  `session+descendants` (echte API-Gegenprobe). Die eigene Read-only-Grenze des Dashboards
  bleibt erhalten.
- Der echte VM-Neuboot mit 0.7.82 zeigte eine weitere Lücke: Die native
  Sitzung samt 62-Byte-Ergebnis lag ausschließlich im Gast-`/tmp`. Der
  Credential-Capture war erfolgreich, aber die bestmögliche EXIT-Trap hatte
  keine History-DB im Share hinterlassen. Nach nachgewiesenem Boot-ID-Wechsel
  war `session_v2` leer; dieser Fall ist ausdrücklich FAIL, kein Resume-PASS.
  Ab 0.7.83 sichert die kontrollierte Finalisierung unter derselben exklusiven
  Sperre nach dem Ende aller nativen Schreiber auch Datenbank, WAL, Lineage
  und XDG-State verpflichtend. Prüfsummen verhindern ein Überspringen bei
  gleichem mtime/Dateigröße; entfernte native Dateien bleiben entfernt.
  Ein Kopierfehler sperrt die Bereinigung. Ohne native Gast-DB wird eine
  vorhandene Sicherung nicht mit einem leeren Vor-Restore-Verzeichnis ersetzt.
  Gezielter Cloud-Nachweis mit echter OpenCode-2.0.32-Binary PASS: Sitzung,
  Benutzer-/Assistant-ID, vollständiger Ergebnistext mit SHA-256 und eigener
  synthetischer Key bleiben nach Sicherung, vollständigem Leeren und Restore
  identisch, ohne erneuten Modellaufruf. Zusätzlich Kopierfehler, leeres
  Boot-Verzeichnis, veraltete Zieldatei, private Credentials und ausgeschlossene
  Legacy-Auth geprüft. Der entsprechende reale Neuboot besteht mit 0.7.84
  (Einzelheiten unten).
- Zusätzliche Cloud-Integration mit tatsächlicher nativer V2-Plugin-Initialisierung
  und Hooks, Taskboard 0.6.0, MCP-Transport und unveränderter MonitorEngine PASS:
  primierter Manager und zweiter Wake erhalten getrennte exakte Receipts und
  vollständige Originaltexte mit verifiziertem SHA-256. Genau zwei lokale
  Mock-Anfragen; ein weiterer Takt erzeugt keine Zusatzinferenz. Anschließend
  produktkonformes Deaktivieren. Auch mit echtem eigenem Git-Commit geprüft.
  Der eigene Diagnoseaufruf an einer bestehenden Sitzung ist zusätzlich gegen
  den tatsächlichen `monitor-main`-Prozess mit dessen PID/Umgebung geprüft.
  Dies ersetzt keine systemd-/AppArmor-/KVM-/9p-Abnahme auf testproxmox.
- Die echte Provider-Wrapper-Probe zeigte einen konkreten Automatisierungsfehler:
  nichtinteraktive Lima-Aufrufe konnten beim Aufruf aus `bash -s`/einem
  Here-Dokument den Rest des aufrufenden Skripts von stdin verbrauchen.
  Ab 0.7.84 schließen strukturierte Provider-List-/Logout-Aufrufe und die
  kontrollierte Lifecycle-Finalisierung ihre Eingabe am Aufrufort. Der
  interaktive VM-Einstieg bleibt separat. Gezielter Vorher-/Nachher-Nachweis
  mit echten stdin-lesenden Kindprozessen und Bash 5 sowie 3.2.57 PASS:
  Liste, Logout und Capture behalten das folgende Hostkommando; JSON-Capture
  und Auth-Publikation funktionieren weiter. Nach einer ersten Probe bei
  gestopptem Webserver wurde der reale Nachweis mit laufendem Backend
  wiederholt: native Live-Credential-Metadaten, Exit 0 und die nachfolgende
  Markerzeile blieben erhalten. Der VM-Aufruf wurde damit tatsächlich geprüft.
- Diese Live-Probe zeigte einen separaten Anzeigefehler: Nach erfolgreicher
  nativer Abfrage blieb die Host-Statusvariable auf dem ursprünglichen
  „kein Server“-Wert. Ab 0.7.85 wird Erfolg ausdrücklich gesetzt; ein wirklich
  fehlender Server bleibt unbekannt, ein tatsächlicher Abfragefehler bleibt
  ein Fehler. Gezielte Vorher-/Nachher-Proben an der echten CLI-Funktion mit
  Bash 5 und 3.2.57 bestätigen alle drei Fälle sowie gestoppte/fehlende
  Sitzungen und Vorlagenfehler. Die erneute reale Live-Abfrage mit 0.7.85
  bestätigt native Metadaten, Exit 0, erhaltene Markerzeile und das Ende der
  falschen Unbekannt-Meldung.

## Reale Abnahme mit 0.7.84

Der kombinierte Bericht vom 19. Oktober wurde vollständig gelesen und als
UTF-8-Original geprüft: 8743 Byte, SHA-256
`ef2c464ac0d8e87accd7f879595a5f00ae0fed7ede6966a0fea36031b47aaacd`.
Private Verbindungsdaten und Credential-Dateien bleiben außerhalb des Repos.

Die kontrollierte Finalisierung schrieb die native DB mit sieben vorhandenen
Sitzungen in den Share. Nach regulärem Controller-Sync und Lima-Stop/Start
änderte sich die Boot-ID; Gast-`/tmp` enthielt die Laufzeitdaten nicht mehr.
Der normale Attach aus 0.7.84 stellte die Daten wieder her und erreichte
vollständige MCP-Bereitschaft. Native Session-ID, Nachrichten-IDs und Parent,
der vollständige 85-Byte-Ergebnistext mit SHA-256
`1487dec732ccb1acd83cc5786d2ab5c4f266618d3762500688c2611e343d33d4`
sowie der synthetische Key blieben identisch. Der Mock-Zähler blieb bei sechs;
der Restore erzeugte keine Inference und keine neue Sitzung.

Der echte V2-Hostwrapper führte OAuth-Dryrun und Logout aus. Die native DB und
der private Snapshot enthielten danach weiterhin den unabhängigen Key. Nach
dem Neuboot ließ sich das vorhandene Taskboard-Ticket lesen und genau ein
neues Testticket anlegen und zurücklesen. Der frühere SQLite-malformed-Fehler
trat dabei nicht auf; seine ursprüngliche Ursache bleibt unbewiesen.

Die Dateiprüfung über 9p bestätigt Inhaltsübertragung in beide Richtungen und
ein Host-inotify-Ereignis bei Gast-Schreibzugriff. **Ein `flock` im Host
verhinderte den Gastzugriff auf dieselbe Lockdatei nicht.** Daher besteht kein
Nachweis einer gemeinsamen exklusiven Host-/Gast-Sperre. Die bestehenden
Adapter-Sperren koordinieren kooperierende Prozesse im selben Gast; daraus
folgt keine Sperre gegen direkte Host-Schreiber. Die Nachprüfung beobachtete
im Gast innerhalb von fünf Sekunden kein inotify-Event bei einem Host-Write.
Dateisichtbarkeit und Push-Benachrichtigung sind verschiedene Eigenschaften;
Gastwerkzeuge, die Hoständerungen erkennen müssen, benötigen hier Polling.
Momentaufnahmen der offenen Dateien und Limits in
Host und Gast zeigten keine Anomalie; sie sind kein Last- oder ENFILE-Nachweis.

Der ursprüngliche Monitor bleibt deaktiviert und seine unsicheren Aufträge
bleiben erhalten. Eine gezielte Probe an einer bestehenden Sitzung bestätigt
im tatsächlichen Unit-User-/AppArmor-Kontext Settings, Exposition, Status und
Adoption. Adoption dauerte 1445 ms bei 3000 ms Frist: ein Timeout ist damit
nicht belegt. Auch ein Worktreefehler ist nicht belegt. Die eigentliche
Erzeugungs-/Dispatchunsicherheit des Engine-Diensts ist noch offen und wird
mit einer begrenzten Probe am tatsächlichen Erzeugungspfad eingegrenzt.
Diese eine Probe gelang vollständig, ohne Inference: native Erzeugung
1820 ms, Adoption 607 ms, gesamter Ablauf 3366 ms bei getrennten Fristen.
Sie beweist keinen Daemon-Dispatch. Ein frischer `create_monitor`-Aufruf
lieferte dagegen einen internen Fehler; vollständige MCP-Liste und lesender
Registry-Abgleich fanden anschließend keinen neuen Eintrag. Der genaue
Fehlerzeitpunkt vor oder nach einer Veröffentlichung ist damit nicht belegt.

## Resolverkorrektur mit 0.7.86 / MCP 0.1.68

Der echte Engine-Dienst protokollierte `spawnSync python3 ETIMEDOUT`, fehlende
`.lock/owner`-Dateien und nicht erworbene Registry-Locks. Der gemeinsame
Gast-Pfadresolver startete bei jeder Auflösung pro Verzeichniskomponente einen
eigenen `stat`-Prozess. Wiederholte synchrone Auflösungen blockieren dadurch
die Node-Dienste besonders auf kleinen verschachtelten Hosts.

Die Korrektur bündelt die GNU-stat-Abfrage je geprüftem Pfad. Absolute und
normalisierte Pfade, jede Komponente, Eigentümer, Rechte, Symlinks und alle
Dateisystemtypen werden weiterhin geprüft; unvollständige stat-Ausgaben
scheitern geschlossen. Es gibt keinen Pfadcache und keine höhere Frist.
Die MonitorEngine, Claims und WAL bleiben unverändert.

Gezielte Cloud-Proben bewahren die Schutzgrenzen einschließlich eines
simulierten 9p-Vorfahren. Für eine Auflösung mit Readback sinkt die Zahl der
externen stat-Prozesse von 38 auf 8. Quellhelper, eingebetteter Payload und
MCP-Archiv stimmen bytegenau überein. Die native Integration mit Taskboard,
MCP, echten V2-Hooks, Priming und zweitem Wake besteht erneut.

Die reale Messung im Unit-User-/AppArmor-Kontext bestätigt für je eine
Auflösung 36 statt 6 stat-Starts und 530 statt 136 ms. Der normale warme
Attach lädt MCP 0.1.68 und den neuen Helper; acht vorhandene Sitzungen, Key
und zwei Taskboard-Tickets bleiben erhalten. Ein neuer Testmonitor liefert
eine erfolgreiche Create-Antwort samt persistentem Eintrag. Die Create-Dauer
beträgt weiterhin 16 Sekunden; ein allgemeiner Registry- oder Lock-Fix ist
daraus nicht bewiesen.

Der Daemon-Dispatch bleibt offen: Das lange Testintervall von 86400 Sekunden
setzt den nächsten automatischen Lauf erwartungsgemäß auf den Folgetag.
Ein erster Lauf muss deshalb ausdrücklich angefordert werden. Der gemessene
`trigger_monitor` lieferte einen internen Fehler; es entstanden keine neue
Sitzung, kein Receipt und keine weitere Mock-Inference. Beide Testmonitore
sind wieder deaktiviert. Das Engine-Log meldet einen noch offenen Wake und
Registry-Lockfehler. Eine zeitlich begrenzte Metadatenspur soll den konkreten
offenen Funktionsaufruf zeigen; sie ersetzt keine unveränderte Produktabnahme.

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
