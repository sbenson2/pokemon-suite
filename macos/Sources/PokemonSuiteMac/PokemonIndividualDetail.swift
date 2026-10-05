import SwiftUI
import SuiteCore

/// One owned individual as Trading shows it: sprite, name, types and shiny, then
/// Overview, Stats and Moves. The Bank's Inspect opens the same view.
struct PokemonIndividualDetail: View {
    @EnvironmentObject var model: SuiteModel
    let mon: JSONValue
    @Binding var section: String

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                ROMAsset(kind: "pokemon", key: mon["nationalSpeciesId"].text, shiny: mon["shiny"].bool, size: 80, label: mon["name"].string)
                VStack(alignment: .leading, spacing: 6) {
                    Text(mon["name"].string).font(.title3.weight(.semibold))
                    Text(mon["types"].array.map { $0.string.capitalized }.joined(separator: " / ")).font(.callout).foregroundStyle(.secondary)
                    if mon["shiny"].bool { Label("Shiny", systemImage: "sparkles").font(.caption).foregroundStyle(.orange) }
                }
                Spacer(minLength: 0)
            }.padding(16)
            SectionTabs(label: "Pokémon details", items: ["Overview", "Stats", "Moves"], selection: $section)
            BorderedScroll { detail }
        }
    }

    @ViewBuilder private var detail: some View {
        if section == "Overview" {
            VStack(alignment: .leading, spacing: 14) {
                if let save = mon["saveLabel"].string.nonempty { LabeledContent("Save", value: save) }
                LabeledContent("Location", value: BankIndex.location(mon))
                if !mon["alsoIn"].array.isEmpty { LabeledContent("Also in", value: mon["alsoIn"].array.map(\.string).joined(separator: "\n")) }
                if mon["level"].int > 0 { LabeledContent("Level", value: mon["level"].text) }
                if let nature = mon["natureName"].string.nonempty { LabeledContent("Nature", value: nature) }
                if let ability = mon["ability"].string.nonempty { LabeledContent("Ability", value: ability) }
                LabeledContent("Held item", value: mon["heldItem"].int == 0 ? "None" : CartridgeItem.name(nativeID: mon["heldItem"].int, catalog: model.dex["heldItems"].array) ?? "Item \(mon["heldItem"].int)")
            }
        } else if section == "Stats" {
            Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 12) {
                GridRow { Text("Stat"); Text("IV"); Text("EV") }.font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                ForEach(["hp", "attack", "defense", "spAttack", "spDefense", "speed"], id: \.self) { key in
                    GridRow { Text(["hp":"HP","attack":"Attack","defense":"Defense","spAttack":"Sp. Attack","spDefense":"Sp. Defense","speed":"Speed"][key]!); Text(mon["ivs"][key].text); Text(mon["evs"][key].text) }.monospacedDigit()
                }
            }
        } else {
            VStack(spacing: 14) {
                ForEach(Array(mon["moveDetails"].array.enumerated()), id: \.offset) { _, move in
                    HStack { Text(move["name"].string); Spacer(); Text("\(move["pp"].text) PP").foregroundStyle(.secondary).monospacedDigit() }
                }
            }
        }
    }
}
