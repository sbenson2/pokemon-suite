import SwiftUI
import SuiteCore

struct EffortTrainingForm: View {
    @EnvironmentObject var model: SuiteModel
    @State private var pokemon: [JSONValue] = []
    @State private var selection = ""
    @State private var draft = EffortTrainingDraft()
    @State private var loading = true
    @State private var error: String?
    private let names = ["hp": "HP", "attack": "Attack", "defense": "Defense", "speed": "Speed", "spAttack": "Sp. Attack", "spDefense": "Sp. Defense"]
    var body: some View {
        Group {
        if loading { ProgressView("Reading current save…") }
        else if let error { Text(error).foregroundStyle(.secondary); Button("Reload Pokémon") { Task { await load() } } }
        else if pokemon.isEmpty { Text("No eligible Pokémon were found in the current save.").foregroundStyle(.secondary) }
        else {
            Picker("Pokémon", selection: $selection) {
                ForEach(pokemon, id: \.inventoryFingerprint) { p in
                    Text(p["name"].string + (p["shiny"].bool ? " · Shiny" : "") + " · " + (p["location"]["kind"].string == "party" ? "Party" : "Box \(p["location"]["box"].int + 1)"))
                        .tag(p["fingerprint"].string)
                }
            }.onChange(of: selection) { _, value in draft = EffortTrainingDraft(pokemon: pokemon.first { $0["fingerprint"].string == value } ?? .null) }
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                GridRow { Text("Stat"); Text("Current EV"); Text("Target EV"); Text("IV min"); Text("IV max") }.font(.caption).foregroundStyle(.secondary)
                ForEach(EffortTrainingDraft.stats, id: \.self) { stat in
                    GridRow {
                        Text(names[stat] ?? stat)
                        Text("\(draft.pokemon["evs"][stat].int)").monospacedDigit().foregroundStyle(.secondary)
                        TextField("\(names[stat] ?? stat) target EV", value: Binding(get: { draft.evs[stat] ?? 0 }, set: { draft.evs[stat] = $0 }), format: .number)
                        TextField("\(names[stat] ?? stat) minimum IV", value: Binding(get: { draft.minIvs[stat] ?? 0 }, set: { draft.minIvs[stat] = $0 }), format: .number)
                        TextField("\(names[stat] ?? stat) maximum IV", value: Binding(get: { draft.maxIvs[stat] ?? 31 }, set: { draft.maxIvs[stat] = $0 }), format: .number)
                    }
                }
            }.textFieldStyle(.roundedBorder)
            HStack {
                Text("\(draft.evs.values.reduce(0, +)) / 510 EVs").foregroundStyle(.secondary)
                Spacer()
                Button("Start EV Training") { model.botAction("start", task: draft.request) }
                    .buttonStyle(.borderedProminent).disabled(model.busy || draft.validation != nil || (!model.session["campaign"].isNull && model.session["campaign"]["status"].string != "complete"))
            }
            if let issue = draft.validation { Text(issue).font(.callout).foregroundStyle(.secondary) }
            Text("Trains in FireRed and saves the verified spread. IV ranges check this individual; they do not change its IVs.").font(.caption).foregroundStyle(.secondary)
        }
        }.task(id: model.selectedGame) { await load() }
    }
    private func load() async {
        let game = model.selectedGame
        loading = true; error = nil
        do {
            let value = try await model.api?.get("/api/pokemon-suite/training-pokemon?game=\(game)") ?? .null
            guard !Task.isCancelled, game == model.selectedGame else { return }
            pokemon = value["pokemon"].array
            selection = pokemon.first?["fingerprint"].string ?? ""
            draft = EffortTrainingDraft(pokemon: pokemon.first ?? .null)
        } catch { guard !Task.isCancelled, game == model.selectedGame else { return }; self.error = error.localizedDescription }
        loading = false
    }
}

private extension JSONValue { var inventoryFingerprint: String { self["fingerprint"].string } }
