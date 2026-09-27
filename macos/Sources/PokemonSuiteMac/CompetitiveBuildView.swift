import SwiftUI
import SuiteCore

struct CompetitiveBuildView: View {
    @EnvironmentObject var model: SuiteModel
    @Binding var attached: JSONValue
    @State private var catalog: JSONValue = .null
    @State private var selection: JSONValue = .null
    @State private var format = "doubles"
    @State private var presetID = ""
    @State private var spread = 0
    @State private var issue: String?
    private var presets: [JSONValue] { catalog["presets"].array.filter { $0["format"].string == format && $0["sourceSpeciesIds"].array.contains(.number(Double(model.selectedSpecies))) } }
    private var preset: JSONValue { presets.first { $0["id"].string == presetID } ?? .null }
    var body: some View {
        Section("Competitive preparation") {
            if !attached.isNull {
                LabeledContent("Attached build", value: readableGameText(attached["presetId"].string))
                Button("Remove Build") { attached = .null }
            }
            if let issue { Text(issue).foregroundStyle(.secondary) }
            else if catalog.isNull { ProgressView("Reading builds…") }
            else if catalog["availability"].string == "not-bundled" {
                Text("Community builds are not included in this edition. Set your own nature, ability, IVs, moves and held item in Traits and Training.").font(.callout).foregroundStyle(.secondary)
            } else {
                Picker("Format", selection: $format) { Text("Doubles").tag("doubles"); Text("Singles").tag("singles") }
                if presets.isEmpty { Text("No build is available for this Pokémon or its evolutions.").foregroundStyle(.secondary) }
                else {
                    Picker("Build", selection: $presetID) { ForEach(presets, id: \.gameID) { Text($0["pokemon"].string + " · " + $0["name"].string).tag($0["id"].string) } }
                    if !preset.isNull {
                        ForEach([("nature", "natures", "Nature"), ("ability", "abilities", "Ability"), ("item", "items", "Held item")], id: \.0) { field, options, label in
                            Picker(label, selection: choice(field)) {
                                if preset[options].array.isEmpty { Text("Choose in destination game").tag("") }
                                ForEach(preset[options].array.map(\.string), id: \.self) { Text($0).tag($0) }
                            }
                        }
                        ForEach(0..<preset["moves"].array.count, id: \.self) { index in
                            Picker("Move \(index + 1)", selection: Binding(get: { selection["moves"].array[safe: index]?.string ?? "" }, set: { value in
                                var moves = selection["moves"].array; guard moves.indices.contains(index) else { return }; moves[index] = .string(value); selection["moves"] = .array(moves)
                            })) { ForEach(preset["moves"].array[index].array.map(\.string), id: \.self) { Text($0).tag($0) } }
                        }
                        Picker("Stat spread", selection: $spread) { ForEach(Array(preset["spreads"].array.enumerated()), id: \.offset) { index, _ in Text("Spread \(index + 1)").tag(index) } }
                        if let values = preset["spreads"].array[safe: spread] {
                            Text(["hp", "attack", "defense", "specialAttack", "specialDefense", "speed"].map { statName($0) + " " + values[$0].text }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                        }
                        Button("Attach Build") {
                            selection["statPoints"] = preset["spreads"].array[safe: spread] ?? .null; attached = selection
                        }.disabled(Set(selection["moves"].array.map(\.string)).count != 4 || preset["spreads"].array.isEmpty)
                        if let url = URL(string: preset["sourceUrl"].string), url.scheme == "https" { Link("Build source", destination: url) }
                        Text("Checked \(suiteDate(catalog["checkedAt"].string)). Review this build against the destination game’s current rules before online play.").font(.caption).foregroundStyle(.secondary)
                        Text("This build records destination settings. Catch requirements remain in Traits and Training.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .task(id: model.selectedGame) {
            do {
                catalog = try await model.api?.get("/data/champions.json") ?? .null
                if !attached.isNull { format = attached["format"].string }
                presetID = presets.first { $0["id"] == attached["presetId"] }?["id"].string ?? presets.first?["id"].string ?? ""
                resetSelection()
            } catch { issue = error.localizedDescription }
        }
        .onChange(of: format) { _, _ in presetID = presets.first?["id"].string ?? "" }
        .onChange(of: model.selectedSpecies) { _, _ in presetID = presets.first?["id"].string ?? ""; resetSelection() }
        .onChange(of: presetID) { _, _ in resetSelection() }
    }
    private func choice(_ key: String) -> Binding<String> { Binding(get: { selection[key].string }, set: { selection[key] = $0.isEmpty ? .null : .string($0) }) }
    private func resetSelection() {
        spread = 0
        if attached["presetId"].string == presetID, !attached.isNull {
            selection = attached; spread = preset["spreads"].array.firstIndex(of: attached["statPoints"]) ?? 0
        } else {
            selection = .object(["destination": .string("pokemon-champions"), "format": .string(format), "presetId": .string(presetID), "catalogRevision": catalog["revision"],
                "nature": preset["natures"].array.first ?? .null, "ability": preset["abilities"].array.first ?? .null, "item": preset["items"].array.first ?? .null,
                "moves": .array(preset["moves"].array.map { $0.array.first ?? .null }), "statPoints": preset["spreads"].array.first ?? .null])
        }
    }
}

private extension Array { subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil } }
