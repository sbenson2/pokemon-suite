import SwiftUI
import SuiteCore

struct HuntingDefaultsForm: View {
    @EnvironmentObject var model: SuiteModel
    @Binding var preferences: JSONValue
    var generation: Int { model.dex["generation"].int }
    @State private var section = "Capture"
    var body: some View {
        Section {
            Picker("Hunting defaults", selection: $section) { ForEach(["Capture", "Traits", "Limits"], id: \.self) { Text($0).tag($0) } }.pickerStyle(.segmented).labelsHidden()
        }
        if section == "Capture" {
            Section {
                Toggle("Shiny required", isOn: Binding(get: { preferences["shiny"].string == "required" }, set: { preferences["shiny"] = .string($0 ? "required" : "any") }))
                Picker("Poké Ball", selection: text("ball", "id")) {
                    Text("Bot chooses").tag("any")
                    ForEach(model.dex["balls"].array, id: \.gameID) { Text($0.label).tag($0["id"].string) }
                }
                if preferences["ball"]["id"].string != "any" {
                    Picker("Ball preference", selection: text("ball", "requirement")) { Text("Preferred").tag("preferred"); Text("Required").tag("required") }
                }
                Picker("After saving", selection: text("afterCompletion")) { Text("Finish hunt").tag("stop-save"); Text("Prepare trade").tag("prepare-trade") }
                Picker("Collection stages", selection: text("collectionStages")) { Text("Preserve base forms").tag("base-forms"); Text("Collect every stage").tag("each-stage") }
                if model.selectedGame == "firered" {
                    Toggle("Rare Candy supply (Mail glitch)", isOn: Binding(get: { preferences["qmmRareCandySupply"].bool }, set: { preferences["qmmRareCandySupply"] = .bool($0) }))
                        .help("Off by default. Duplicates Rare Candies with FireRed's question-mark Mail glitch using ordinary button input: a one-time double battle, then ₽50 of Retro Mail per candy. All Mail is taken back before saving.")
                    // An older host has no such key; leave it out of the saved preferences.
                    if !preferences["leagueExpShareTraining"].isNull {
                        Toggle("League training", isOn: Binding(get: { preferences["leagueExpShareTraining"].bool }, set: { preferences["leagueExpShareTraining"] = .bool($0) }))
                            .help("On by default. After the stronger League victory, a Pokémon that still needs levels holds the Exp. Share through League rounds and never battles. A fainted battler, a lost round or another League problem pauses it, and the postgame checklist shows why. To resume, turn this off and save, then turn it on and save again. A resume applies to every FireRed save paused before it.")
                    }
                }
            }
        } else if section == "Traits" {
            Section {
                Picker("Gender", selection: text("gender")) { ForEach(["any", "male", "female", "genderless"], id: \.self) { Text($0.capitalized).tag($0) } }
                if generation >= 3 {
                    DisclosureGroup(preferences["natures"].array.isEmpty ? "Natures: any" : "Natures: \(preferences["natures"].array.count) selected") {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), alignment: .leading)], alignment: .leading, spacing: 10) {
                            ForEach(model.dex["natures"].array, id: \.gameID) { nature in
                                Toggle(nature.label, isOn: Binding(get: { preferences["natures"].array.contains(nature["id"]) }, set: { selected in
                                    var values = preferences["natures"].array.filter { $0 != nature["id"] }
                                    if selected { values.append(nature["id"]) }
                                    preferences["natures"] = .array(values)
                                })).toggleStyle(.checkbox)
                            }
                        }.padding(.vertical, 8)
                    }.help("Leave all unchecked to accept any nature")
                }
            }
            Section(generation == 2 ? "Minimum DVs" : "Minimum IVs") {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(generation == 2 ? ["attack","defense","special","speed"] : ["hp","attack","defense","specialAttack","specialDefense","speed"], id: \.self) { stat in
                        let key = generation == 2 ? "minDvs" : "minIvs"
                        Stepper("\(statName(stat)): \(preferences[key][stat].int)", value: number(key, stat), in: 0...(generation == 2 ? 15 : 31))
                    }
                }
            }
        } else {
            Section {
                TextField("Maximum minutes", value: number("limits", "maxMinutes"), format: .number)
                TextField("Maximum encounters", value: number("limits", "maxEncounters"), format: .number)
                TextField("Balls in reserve", value: number("limits", "minBalls"), format: .number)
                TextField("Maximum spending", value: number("limits", "maxSpend"), format: .number)
            }
        }
        Section {
            if let issue = limitIssue(preferences["limits"]) { Label(issue, systemImage: "exclamationmark.circle").foregroundStyle(.secondary) }
            Button("Save Defaults") {
                let value = preferences, game = model.selectedGame
                model.perform {
                    let result = try await model.api?.post("/api/pokemon-suite/bot-settings", .object(["game": .string(game), "preferences": value]))
                    model.notice = result.map { $0["notice"].isNull ? "Hunting defaults saved." : "Hunting defaults saved. " + $0["notice"].string } ?? "Hunting defaults saved."
                }
            }.buttonStyle(.borderedProminent).disabled(model.busy || limitIssue(preferences["limits"]) != nil)
        }
    }
    func text(_ key: String, _ child: String? = nil) -> Binding<String> {
        Binding(get: { child.map { preferences[key][$0].string } ?? preferences[key].string }, set: { value in
            if let child { preferences[key][child] = .string(value) } else { preferences[key] = .string(value) }
        })
    }
    func number(_ key: String, _ child: String) -> Binding<Int> {
        Binding(get: { preferences[key][child].int }, set: { preferences[key][child] = .number(Double($0)) })
    }
}

func limitIssue(_ limits: JSONValue) -> String? {
    if !(1...10080).contains(limits["maxMinutes"].int) { return "Maximum minutes must be between 1 and 10,080." }
    if !(1...1000000).contains(limits["maxEncounters"].int) { return "Maximum encounters must be between 1 and 1,000,000." }
    if !(0...999).contains(limits["minBalls"].int) { return "Ball reserve must be between 0 and 999." }
    if !(0...999999).contains(limits["maxSpend"].int) { return "Maximum spending must be between 0 and 999,999." }
    return nil
}
