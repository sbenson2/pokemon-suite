import SwiftUI
import SuiteCore

struct BotView: View {
    @EnvironmentObject var model: SuiteModel
    @State private var options: JSONValue = .null
    @State private var preferences: JSONValue = .null
    @State private var section = "Task"
    @State private var activitySection = "Overview"
    @State private var kind = "heal"
    @State private var destination = ""
    @State private var item = 1
    @State private var quantity = 1
    @State private var collection = "base-forms"
    @State private var national = false
    @State private var starter = "random"
    @State private var team = "random"
    @State private var helpers = "allowed"
    @State private var afterCampaign = "postgame"
    @State private var label = "FireRed adventure"
    @State private var replay = false
    @State private var seed = ""
    @State private var teamSeed = ""
    @State private var preview: JSONValue = .null
    var settings: JSONValue {
        .object(["label": .string(label), "starter": .string(starter), "teamMode": .string(team), "helpers": .string(team == "balanced" ? "none" : helpers), "afterCampaign": .string(afterCampaign), "seedMode": .string(replay ? "replay" : "fresh"), "seed": replay ? Double(seed).map(JSONValue.number) ?? .string(seed) : .null, "teamSeed": replay && !teamSeed.isEmpty ? Double(teamSeed).map(JSONValue.number) ?? .string(teamSeed) : .null])
    }
    var runValidation: String? {
        if label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || label.count > 50 { return "Enter a run name with 1–50 characters." }
        if replay && UInt32(seed) == nil { return "Enter a whole run seed from 0 to 4,294,967,295." }
        if replay && !teamSeed.isEmpty && UInt32(teamSeed) == nil && teamSeed.range(of: "^hex:[0-9a-fA-F]{64}$", options: .regularExpression) == nil { return "Use a whole team seed or hex: followed by 64 hexadecimal characters." }
        return nil
    }
    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 5) {
                        Label(BotRunStatus(session: model.session).label, systemImage: BotRunStatus(session: model.session) == .blocked ? "exclamationmark.circle" : model.session["bot"]["enabled"].bool ? "play.circle" : "pause.circle").font(.headline)
                        if BotRunStatus(session: model.session) == .blocked {
                            Button("Review Stop Report") { section = "Activity"; activitySection = "Reports" }.controlSize(.small)
                        }
                        if let goal = ActivityPresentation(session: model.session, catalog: model.dex, now: .now).headline ?? gameGoal(model.session) { Text(goal).font(.callout).foregroundStyle(.secondary).lineLimit(1).help(goal) }
                    }
                    Spacer()
                    Button("Resume Bot") { model.botAction("resume") }.disabled(!model.game["capabilities"]["bot"].bool || model.busy || [.running, .ready, .reconnecting].contains(BotRunStatus(session: model.session)))
                    Button("Stop Bot") { model.botAction("stop") }.disabled(!model.session["bot"]["enabled"].bool || model.busy)
                }
                if model.selectedGame == "firered" && model.game["capabilities"]["bot"].bool { BotAskView() }
            }.padding(12)
            Divider()
            if model.game["capabilities"]["bot"].bool {
                Picker("Bot configuration", selection: $section) {
                    if model.selectedGame == "firered" {
                        Text("Story progress").tag("Story")
                        Text("Task").tag("Task")
                        Text("Shiny collection").tag("Collection")
                        Text("New run").tag("New run")
                        Text("Saves").tag("Saves")
                    }
                    Text("Hunting defaults").tag("Defaults")
                    Text("Activity").tag("Activity")
                }.suiteConfigurationPicker().labelsHidden().padding(.horizontal, 20).padding(.vertical, 12)
                if section == "Story" { BorderedScroll { StoryProgressView() } }
                else if section == "Activity" { BotActivityView(section: $activitySection) }
                else if section == "Saves" { BotSaveProfilesView(profiles: options["profiles"].array) }
                else { Form {
                    Group {
                    if section == "Task" { Section { taskForm } }
                    if section == "Collection" {
                        Section { collectionForm }
                        Section("Collection progress") { ShinyCollectionProgressView() }
                    }
                    if section == "New run" { Section { newRunForm } }
                    if section == "Defaults" && !preferences.isNull { HuntingDefaultsForm(preferences: $preferences) }
                    }
                    #if os(iOS)
                    .listRowBackground(GameFormRowBackground())
                    #endif
                }.formStyle(.grouped).overlay { Rectangle().stroke(.separator, lineWidth: 1).allowsHitTesting(false) } }
            } else {
                ContentUnavailableView {
                    Label("Bot setup unavailable", systemImage: "slider.horizontal.3")
                } description: { Text(model.installed ? "This game’s additional automation tools are available in the complete Suite." : "Add this game to configure its bot.") }
                actions: { Button("Open in Browser", action: model.openCompleteSuite) }
            }
        }
        .task(id: model.selectedGame) {
            options = .null; preferences = .null; preview = .null
            section = model.selectedGame == "firered" ? (model.session["campaign"].isNull ? "Task" : "Story") : "Defaults"
            guard model.installed else { return }
            do {
                options = try await model.api?.get("/api/pokemon-suite/player-tasks?game=\(model.selectedGame)") ?? .null
                destination = options["locations"].array.first?["id"].string ?? ""
                item = options["items"].array.first?["id"].int ?? 1
                preferences = (try await model.api?.get("/api/pokemon-suite/bot-settings?game=\(model.selectedGame)") ?? .null)["preferences"]
            } catch { model.notice = error.localizedDescription }
        }
        .onChange(of: settings) { _, _ in preview = .null }
        .sheet(isPresented: Binding(get: { !preview.isNull }, set: { if !$0 { preview = .null } })) { teamPreview }
    }
    @ViewBuilder var taskForm: some View {
Picker("Task", selection: $kind) { Text("Heal team").tag("heal"); Text("Save game").tag("save"); Text("Travel to a location").tag("travel"); Text("Find an item").tag("item"); Text("Train competitive EVs").tag("ev-training") }.pickerStyle(.menu)
                        if kind == "ev-training" { EffortTrainingForm() }
                        if kind == "travel" { Picker("Destination", selection: $destination) { ForEach(options["locations"].array, id: \.gameID) { Text($0.label).tag($0["id"].string) } } }
                        if kind == "item" {
                            Picker("Item", selection: $item) { ForEach(options["items"].array, id: \.gameID) { Text($0.label).tag($0["id"].int) } }
                            Stepper("Quantity: \(quantity)", value: $quantity, in: 1...99)
                        }
                        HStack {
                            if kind != "ev-training" { Button("Start Task") {
                                var task: JSONValue = .object(["kind": .string(kind)])
                                if kind == "travel" { task["map"] = .string(destination) }
                                if kind == "item" { task["itemId"] = .number(Double(item)); task["quantity"] = .number(Double(quantity)) }
                                model.botAction("start", task: task)
                            }.buttonStyle(.borderedProminent) }
                            Button("Start Postgame Checklist") { model.botAction("postgame") }
                            Button("View Progress") { section = "Activity"; activitySection = "Progress" }
                        }.disabled(model.busy)
    }
    @ViewBuilder var collectionForm: some View {
Toggle("Hunt every National Pokédex entry", isOn: $national)
                        if !national { Picker("Evolution stages", selection: $collection) { Text("Preserve base forms").tag("base-forms"); Text("Collect every stage").tag("each-stage") } }
                        Button("Start Shiny Collection") { model.botAction("collection", task: .object(["collectionStages": .string(national ? "each-stage" : collection), "goal": .string(national ? "national-dex" : "supported")])) }.disabled(model.busy)
    }
    @ViewBuilder var newRunForm: some View {
TextField("Run name", text: $label, prompt: Text("FireRed adventure")).textFieldStyle(.roundedBorder)
                        Picker("Starter", selection: $starter) { ForEach(["random","bulbasaur","charmander","squirtle"], id: \.self) { Text($0.capitalized).tag($0) } }
                        Picker("Team", selection: $team) { Text("Random").tag("random"); Text("Balanced").tag("balanced") }
                        if team == "random" { Picker("Helpers", selection: $helpers) { Text("Allowed").tag("allowed"); Text("Field moves only").tag("field-only"); Text("None").tag("none") } }
                        Picker("After the League", selection: $afterCampaign) { Text("Continue postgame and National Dex").tag("postgame"); Text("Wait for a command").tag("wait") }
                        Toggle("Replay a seed", isOn: $replay)
                        if replay { TextField("Run seed", text: $seed); TextField("Team seed (optional)", text: $teamSeed) }
                        Button("Preview Team") {
                            let value = settings
                            model.perform { preview = (try await model.api?.post("/api/pokemon-suite/campaign-runs/preview", .object(["game": .string(model.selectedGame), "settings": value])) ?? .null)["preview"] }
                        }.disabled(model.busy || runValidation != nil)
                        if let runValidation { Label(runValidation, systemImage: "exclamationmark.circle").foregroundStyle(.secondary) }
    }
    private var teamPreview: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Team preview").font(.title2.weight(.semibold))
                            HStack(spacing: 12) {
                                ForEach(preview["team"].array, id: \.speciesID) { pokemon in
                                    VStack(spacing: 5) {
                                        ROMSprite(id: pokemon["species"].int, size: 64)
                                        Text(model.species.first { $0["id"].int == pokemon["species"].int }?["name"].string ?? pokemon.label).font(.caption)
                                    }.frame(maxWidth: .infinity)
                                }
                            }
                            LabeledContent("Run seed", value: preview["seed"].text)
                            DisclosureGroup("Team replay seed") {
                                Text(preview["teamSeed"].text).font(.system(.callout, design: .monospaced)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                            }
                            HStack {
                            Button("Cancel") { preview = .null }.keyboardShortcut(.cancelAction)
                            Spacer()
                            Text("Creates a separate save.").font(.caption).foregroundStyle(.secondary)
                            Button("Start New Run") {
                                let id = preview["id"]
                                model.perform { try await model.api?.post("/api/pokemon-suite/campaign-runs/start", .object(["game": .string(model.selectedGame), "previewId": id])); preview = .null; model.page = .live }
                            }.buttonStyle(.borderedProminent).disabled(model.busy)
                            }
        }.padding(24).suiteSheetSize(width: 620)
    }

}

struct DataDetails: View {
    let value: JSONValue
    var body: some View { Text(prettyJSON(value)).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
}
func prettyJSON(_ value: JSONValue) -> String {
    let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return (try? encoder.encode(value)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
}

extension JSONValue { var speciesID: Int { self["species"].int } }
