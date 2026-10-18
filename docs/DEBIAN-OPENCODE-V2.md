# Debian und OpenCode V2: gemeinsamer Entwicklungsplan

Stand: 2026-10-18. Entwicklungsbranch: `feat/debian-opencode-v2`.
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

## Experimentmodus dieser ersten Etappe

```bash
OCVM_EXPERIMENT=v2 bash /pfad/zum/branch/opencode-vm.sh --version
```

Dieser Modus verwendet aktuell weiterhin Backend V1. Er trennt
`~/.opencode-vm-v2/`, dessen `global/{config,data,state}/opencode`,
`~/.opencode-vm-v2/lima` und `oc-base-v2` von den stabilen Pfaden.
`install`, `update` und OpenLive-Hostsetup sind in diesem Modus gesperrt.
Immer denselben Modus und einen separaten Testcheckout verwenden. Es findet
keine automatische Übernahme von V1-Config oder Credentials statt.
Globale Experimentkonfiguration wird nur einmal in neue Projektkonfiguration
übernommen; danach bleibt die Konfiguration projektlokal. Es wurde noch keine
Experiment-VM erstellt oder gestartet.

## Verifizierter Stand

- Cloud: Debian 13.6, x86_64; kein `/dev/kvm`. Kein realer Lima/KVM-Nachweis.
- Aktueller Code: gast-native Worktrees sind bereits vorhanden. Ihre bestehende
  Persistenz-/Ownership-Grenze wird nicht neu erfunden.
- npm am 18. Oktober: `@opencode/cli` und `@opencode/client` jeweils 2.0.32.
  Quelltag `v2.0.32`: `843a6c514e606b436a7fe713422ace0a93ad3d61`.
  CLI-/Client-Tarballs und Linux-x64-Binary anhand npm-SHA512 geprüft.
- Isolierte Binary meldet `opencode v2.0.32`. Eigener Loopbackserver gestartet;
  `/api/info`, `/api/location`, `/api/session`, `/api/config`, `/api/agent`
  gelesen und genau eine eigene leere Testsession erstellt. Keine Inference.
- V2 verwendet `serve`, den Client `@opencode/client`, `/api/...` und eine neue
  Plugin-API. Ein alter `/global/health`-Abruf liefert sogar HTML mit HTTP 200;
  HTTP-Erfolg allein ist deshalb keine Backend-Healthprüfung.
- V2-History hat andere Nachrichtenstrukturen; Parent-/Receipt-Zuordnung muss
  fachlich portiert werden. Ein bloßer Paket- oder Importwechsel reicht nicht.
- Debian-Helperproben: projektnamensgleiches MD5, Dateimtime und YAML-Einfügung
  mit erhaltenem Modus 0600 PASS. Fehlendes KVM wird vor Base-Neuaufbau erkannt.
- Bash-Syntax, ShellCheck Fehlerstufe und Vergleich mit dem unveränderten
  Ausgangsskript PASS (keine neuen ShellCheck-Muster). MCP-Typecheck PASS;
  eingebetteter Managed-Runtime-Payload unverändert und aktuell.
- Zusätzliche gezielte Proben PASS: Hashing von Dateinamen mit Backslash,
  ungültige/symlinkbasierte YAML-Dateien bleiben unverändert, keine Lima-Aufrufe
  vor KVM-Fehler, Experiment-Globalsync bleibt aus, OpenLive-Hostsetup gesperrt.
  Der BSD-mtime-Zweig wurde mit einem Befehlsstub geprüft; kein echter Maclauf.
- Produktbackend ist bislang V1. V2-Parität, Proxmox und macOS-Abnahme stehen aus.
- Die lesende Vorbereitung des Testsystems wurde über BI-MC angenommen.
  Der spätere Statusabruf scheiterte mit Timeout und anschließend explizit
  getrenntem Tunnel-Client. Kein bestätigtes Ergebnis, kein VM-Aufbau und
  keine bestätigte freie Ressource. Den ursprünglichen Auftrag nach
  Wiederverbindung abgleichen, nicht erneut absenden.

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
