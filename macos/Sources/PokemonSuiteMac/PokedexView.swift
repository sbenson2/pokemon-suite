import SwiftUI
import SuiteCore

struct PokedexView: View {
    @EnvironmentObject var model: SuiteModel
    @State private var filter = PokedexFilter()
    @State private var shiny = false
    @State private var section = "Overview"
    @State private var moveSearch = ""
    @State private var artworkInfo = false
    var filtered: [JSONValue] { filter.apply(to: model.species) }
    var types: [String] { Set(model.species.flatMap { $0["types"].array.map(\.string) }).sorted() }
    var body: some View {
        if model.species.isEmpty {
            ContentUnavailableView("Pokédex unavailable", systemImage: "book.closed", description: Text("Choose FireRed, LeafGreen, Emerald or Crystal."))
        } else {
            SuiteSplit(leadingFraction: 0.32) {
                VStack(spacing: 0) {
                    VStack(spacing: 8) {
                        TextField("Name, number or place", text: $filter.query).textFieldStyle(.roundedBorder).accessibilityLabel("Search Pokémon")
                        HStack {
                            Picker("Pokédex", selection: $filter.scope) {
                                Text(model.dex["regionalLabel"].string.nonempty ?? "Regional").tag("regional")
                                Text("National").tag("national")
                            }.labelsHidden().accessibilityLabel("Pokédex scope")
                            Picker("Type", selection: $filter.type) { Text("All types").tag("any"); ForEach(types, id: \.self) { Text($0.capitalized).tag($0) } }.labelsHidden().accessibilityLabel("Pokémon type")
                        }
                        HStack {
                            Picker("Availability", selection: $filter.availability) {
                                Text("All Pokémon").tag("all")
                                Text("Encounter or gift").tag("encounter")
                                Text("Other acquisition").tag("other")
                            }.labelsHidden().accessibilityLabel("Pokémon availability")
                            Spacer(); Text("\(filtered.count)").font(.caption).foregroundStyle(.secondary).accessibilityLabel("\(filtered.count) Pokémon")
                        }
                    }.padding(12)
                    List(selection: $model.selectedSpecies) {
                        ForEach(filtered, id: \.gameID) { pokemon in
                            Button { model.selectedSpecies = pokemon["id"].int } label: {
                                HStack {
                                    ROMSprite(id: pokemon["id"].int, size: 32).accessibilityHidden(true)
                                    Text(pokemon["name"].string)
                                    Spacer(); Text(String(format: "%03d", filter.number(pokemon))).font(.caption).foregroundStyle(.secondary)
                                }.contentShape(Rectangle())
                            }.buttonStyle(.plain).tag(pokemon["id"].int)
                        }
                    }.listStyle(.inset).overlay(Rectangle().stroke(.separator, lineWidth: 1)).overlay { if filtered.isEmpty { ContentUnavailableView.search(text: filter.query) } }
                }
            } trailing: {
                VStack(spacing: 0) {
                    let mon = model.chosenPokemon
                    HStack(spacing: 16) {
                        ROMSprite(id: mon["id"].int, shiny: shiny, size: 88)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(mon["name"].string).font(.title2.weight(.semibold))
                            Text(mon["types"].array.map { $0.string.capitalized }.joined(separator: " / ")).foregroundStyle(.secondary)
                            Toggle("Shiny", isOn: $shiny).toggleStyle(.checkbox)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 12) {
                            Text(String(format: "No. %03d", mon["id"].int)).font(.callout).foregroundStyle(.secondary)
                            Button("Set Up Hunt") { model.page = .farming }.buttonStyle(.borderedProminent)
                            if model.state["artwork"][model.selectedGame]["artwork"].string != "local-rom" {
                                Button("Artwork") { artworkInfo = true }.popover(isPresented: $artworkInfo) { ArtworkCoverage(game: model.selectedGame).padding(16).frame(width: 320) }
                            }
                        }
                    }.padding(16)
                    SectionTabs(label: "Pokédex details", items: ["Overview", "Locations", "Evolution", "Moves"], selection: $section)
                    if section == "Moves" { TextField("Search moves", text: $moveSearch).textFieldStyle(.roundedBorder).padding(.horizontal, 16).padding(.bottom, 12) }
                    BorderedScroll {
                        if section == "Overview" {
                            VStack(alignment: .leading, spacing: 16) {
                                Text("Base stats").font(.headline)
                                ForEach(["hp","attack","defense","specialAttack","specialDefense","speed"], id: \.self) { stat in
                                    HStack {
                                        Text(statName(stat)).frame(width: 95, alignment: .leading)
                                        Gauge(value: Double(mon["stats"][stat].int), in: 0...255) { EmptyView() }.tint(.accentColor).accessibilityLabel(statName(stat)).accessibilityValue(mon["stats"][stat].text)
                                        Text(mon["stats"][stat].text).monospacedDigit().frame(width: 32, alignment: .trailing)
                                    }
                                }
                                Divider()
                                LabeledContent("Abilities", value: mon["abilities"].array.map(\.label).joined(separator: ", "))
                                HStack { LabeledContent("Catch rate", value: mon["catchRate"].text); Spacer(minLength: 30); LabeledContent("Egg groups", value: mon["eggGroups"].array.map(\.text).joined(separator: ", ")) }
                                HStack { LabeledContent("Height", value: String(format: "%.1f m", mon["height"].double)); Spacer(minLength: 30); LabeledContent("Weight", value: String(format: "%.1f kg", mon["weight"].double)) }
                            }
                        } else if section == "Locations" {
                            VStack(alignment: .leading, spacing: 16) {
                                if mon["encounters"].array.isEmpty { Text("No wild encounters. Preview a hunt for other routes.").foregroundStyle(.secondary) }
                                ForEach(mon["encounters"].array, id: \.gameID) { encounter in
                                    HStack {
                                        VStack(alignment: .leading, spacing: 4) { Text(encounter["location"].string); Text(encounter["method"].string).font(.caption).foregroundStyle(.secondary) }
                                        Spacer()
                                        Text("Lv. \(encounter["minLevel"].text)–\(encounter["maxLevel"].text)").font(.callout)
                                        Text("\(encounter["chance"].text)%").font(.callout).foregroundStyle(.secondary).frame(width: 45, alignment: .trailing)
                                    }
                                }
                            }
                        } else if section == "Evolution" {
                            VStack(alignment: .leading, spacing: 12) {
                                if let earlier = model.species.first(where: { $0["id"].int == mon["evolvesFrom"].int }) {
                                    Text("Earlier form").font(.headline)
                                    evolutionButton(earlier, condition: earlier["evolutions"].array.first { $0["speciesId"].int == mon["id"].int }?["condition"].string ?? "")
                                }
                                if !mon["evolutions"].array.isEmpty {
                                    Text("Evolutions").font(.headline)
                                    ForEach(Array(mon["evolutions"].array.enumerated()), id: \.offset) { _, evolution in
                                        if let next = model.species.first(where: { $0["id"].int == evolution["speciesId"].int }) { evolutionButton(next, condition: evolution["condition"].string) }
                                    }
                                } else { Text("No later evolution in this Pokédex.").foregroundStyle(.secondary) }
                                Button("Plan Acquisition") { model.page = .farming }.help("Preview a hunt to check game access, items and any required trades")
                            }
                        } else {
                            VStack(spacing: 14) {
                                HStack {
                                    Text("Move").frame(maxWidth: .infinity, alignment: .leading)
                                    Text("Type").frame(width: 70, alignment: .leading)
                                    Text("Power").frame(width: 42, alignment: .trailing)
                                    Text("PP").frame(width: 32, alignment: .trailing)
                                }.font(.caption).foregroundStyle(.secondary)
                                ForEach(Array(mon["learnset"].array.enumerated()), id: \.offset) { _, entry in
                                    let move = model.dex["moves"].array.first { $0["id"].int == entry["moveId"].int } ?? .null
                                    if moveSearch.isEmpty || move.label.localizedCaseInsensitiveContains(moveSearch) {
                                        HStack {
                                            VStack(alignment: .leading, spacing: 3) {
                                                Text(move.label)
                                                Text(entry["method"].string == "level-up" ? "Level \(entry["level"].text)" : !entry["machine"].isNull ? entry["machine"].text.uppercased() : readableGameText(entry["method"].string)).font(.caption).foregroundStyle(.secondary)
                                            }.frame(maxWidth: .infinity, alignment: .leading)
                                            Text(move["type"].string.capitalized).font(.callout).frame(width: 70, alignment: .leading)
                                            Text(move["power"].int > 0 ? move["power"].text : "—").monospacedDigit().frame(width: 42, alignment: .trailing)
                                            Text(move["pp"].text).monospacedDigit().frame(width: 32, alignment: .trailing)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .onChange(of: model.selectedSpecies) { _, _ in moveSearch = "" }
            .task(id: model.dex["game"].string) {
                filter = PokedexFilter(scope: model.dex["defaultDex"].string == "regional" ? "regional" : "national")
                if !filtered.contains(where: { $0["id"].int == model.selectedSpecies }), let first = filtered.first { model.selectedSpecies = first["id"].int }
            }
        }
    }
    private func evolutionButton(_ pokemon: JSONValue, condition: String) -> some View {
        Button {
            filter.query = ""; filter.type = "any"; filter.availability = "all"
            if filter.scope == "regional", pokemon["regionalNumber"].int == 0 { filter.scope = "national" }
            model.selectedSpecies = pokemon["id"].int
        } label: {
            HStack(spacing: 12) {
                ROMSprite(id: pokemon["id"].int, shiny: shiny, size: 48)
                VStack(alignment: .leading, spacing: 4) {
                    Text(pokemon["name"].string).fontWeight(.medium)
                    if !condition.isEmpty { Text(condition).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.leading) }
                }
                Spacer(); Image(systemName: "chevron.right").foregroundStyle(.secondary)
            }.padding(.vertical, 5).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

}

func statName(_ stat: String) -> String {
    ["hp":"HP","attack":"Attack","defense":"Defense","specialAttack":"Sp. Attack","specialDefense":"Sp. Defense","speed":"Speed","special":"Special"][stat] ?? stat
}
