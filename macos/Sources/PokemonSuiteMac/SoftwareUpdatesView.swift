import AppKit
import SwiftUI
import SuiteCore

struct SoftwareUpdatesView: View {
    @EnvironmentObject var model: SuiteModel
    @EnvironmentObject var appUpdater: AppUpdater
    @State private var allowIntervention = false
    @State private var feedURL = ""
    @State private var available: [JSONValue] = []
    @State private var section = "App"
    @State private var choosingFile = false
    var software: JSONValue { model.state["software"] }
    var body: some View {
        VStack(spacing: 0) {
        SectionTabs(label: "Software updates", items: ["App", "Bot and Data", "History", "Source"], selection: $section)
        Form {
            if section == "App" {
            Section("Mac application") {
                LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Development")
                Button("Check for App Updates…", action: appUpdater.check).disabled(!appUpdater.available)
                Text(appUpdater.message).font(.callout).foregroundStyle(.secondary)
            }
            }
            if section == "Bot and Data" {
            Section("Bot and game data") {
                HStack {
                    Button("Import Signed Package…") { chooseFile { send("import", ["path": .string($0.path)]) } }
                    Button("Check for Packages") {
                        model.perform { available = (try await model.api?.post("/api/pokemon-suite/updates", .object(["action": .string("check")])) ?? .null)["result"]["packages"].array }
                    }.disabled(!software["feed"]["configured"].bool)
                }
                ForEach(Array(available.enumerated()), id: \.offset) { _, package in
                    HStack {
                        Text(package["id"].text + " " + package["version"].text)
                        Spacer()
                        Button("Download") { send("download", ["target": package["target"]]) }
                    }
                }
                HStack {
                    Toggle("Allow campaign intervention", isOn: $allowIntervention)
                    InfoButton(title: "Campaign updates", message: "Applying an update changes the run and records an intervention. It cannot count as an uninterrupted test.")
                }
                ForEach(Array(software["installed"].array.filter { $0["games"].array.contains(.string(model.selectedGame)) }.enumerated()), id: \.offset) { _, package in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack { Text(package["id"].text).fontWeight(.medium); Spacer(); Text(package["version"].text).monospacedDigit().foregroundStyle(.secondary) }
                        Menu("Actions") {
                            Button(package["kind"].string == "data" ? "Use for New Plans" : "Set Default") { send("activate", ["game": .string(model.selectedGame), "digest": package["digest"]]) }
                            if ["engine", "planner", "game", "emulator"].contains(package["kind"].string) {
                                Button("Apply to Current Game") { send("apply", ["game": .string(model.selectedGame), "digest": package["digest"], "requestId": .string(UUID().uuidString), "allowIntervention": .bool(allowIntervention)]) }
                            }
                        }.fixedSize()
                    }.padding(.vertical, 4)
                }
                if software["installed"].array.isEmpty { Text("Using the engine and data included with this app.").foregroundStyle(.secondary) }
            }
            }
            if section == "History" {
            Section("Update activity") {
                if software["updates"].array.isEmpty { Text("No updates applied").foregroundStyle(.secondary) }
                ForEach(Array(software["updates"].array.prefix(8).enumerated()), id: \.offset) { _, update in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(update["game"].text.capitalized + " · " + update["state"].text.capitalized).fontWeight(.medium)
                        Text(update["detail"]["reason"].text).font(.callout).foregroundStyle(.secondary)
                        if update["state"].string == "failed" { Button("Resume Held Game") { send("recover", ["id": update["id"]]) } }
                    }
                }
            }
            }
            if section == "Source" {
            Section {
                    Text("Release source").font(.headline)
                    Button("Import Public Signing Key…") {
                        chooseFile { url in
                            do { send("trust-key", ["publicKey": .string(try String(contentsOf: url, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)), "label": .string(url.deletingPathExtension().lastPathComponent)]) }
                            catch { model.notice = error.localizedDescription }
                        }
                    }
                    TextField("HTTPS release feed", text: $feedURL)
                    Button("Choose Trusted Root…") { chooseFile { send("configure-feed", ["url": .string(feedURL), "rootPath": .string($0.path)]) } }.disabled(feedURL.isEmpty)
                    Text(software["feed"]["configured"].bool ? software["feed"]["url"].text : software["feed"]["message"].text).font(.caption).textSelection(.enabled)
            }
            }
        }.formStyle(.grouped).overlay(Rectangle().stroke(.separator, lineWidth: 1).allowsHitTesting(false)).disabled(model.busy || model.api == nil || choosingFile)
            .onAppear { feedURL = software["feed"]["url"].string }
        }
    }
    func send(_ action: String, _ fields: [String: JSONValue] = [:]) {
        model.perform { try await model.api?.post("/api/pokemon-suite/updates", .object(fields.merging(["action": .string(action)]) { _, new in new })); model.notice = "Software update request recorded." }
    }
    func chooseFile(_ completion: @escaping (URL) -> Void) {
        guard !choosingFile else { return }
        choosingFile = true
        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
        let finished: (NSApplication.ModalResponse) -> Void = { response in
            choosingFile = false
            if response == .OK, let url = panel.url { completion(url) }
        }
        if let window = NSApp.keyWindow { panel.beginSheetModal(for: window, completionHandler: finished) }
        else { panel.begin(completionHandler: finished) }
    }
}
