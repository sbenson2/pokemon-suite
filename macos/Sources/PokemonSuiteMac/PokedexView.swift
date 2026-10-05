import SwiftUI
import SuiteCore

/// The Bank: every species in the game's Pokédex with the individuals owned in every
/// save the app knows (read-only), how FireRed obtains it, and "Get it", which asks the
/// bot through the same goals as Ask. Pokédex details stay alongside. Bank data covers FireRed.
struct PokedexView: View {
    @EnvironmentObject var model: SuiteModel
    @State private var filter = PokedexFilter()
    @State private var shiny = false
    @State private var section = "Owned"
    @State private var moveSearch = ""
    @State private var artworkInfo = false
    /// GET /api/pokemon-suite/bank: every species' ownership and route.
    @State private var bank: JSONValue = .null
    /// The selected species' individuals in every save.
    @State private var owned: JSONValue = .null
    @State private var issue: String?
    @State private var inspecting: JSONValue?
    @State private var gettingIt = false
    @State private var building: CompetitiveBuilderRequest?
    private var banked: Bool { model.selectedGame == "firered" }
    private var entries: [Int: JSONValue] { BankIndex.species(bank) }
    var filtered: [JSONValue] { filter.apply(to: model.species, bank: entries) }
    var types: [String] { Set(model.species.flatMap { $0["types"].array.map(\.string) }).sorted() }
    private var sections: [String] { banked ? ["Owned", "Overview", "Locations", "Evolution", "Moves"] : ["Overview", "Locations", "Evolution", "Moves"] }

    var body: some View {
        if model.species.isEmpty {
            ContentUnavailableView("Bank unavailable", systemImage: "book.closed", description: Text("Choose FireRed, LeafGreen, Emerald or Crystal."))
        } else {
            SuiteSplit(leadingFraction: 0.32) {
                GamePanel(title: "Bank", symbol: "book.closed", contentPadding: 0) {
                    VStack(spacing: 8) {
                        TextField("Name, number, place or route", text: $filter.query).textFieldStyle(.roundedBorder).accessibilityLabel("Search Pokémon")
                        HStack {
                            Picker("Pokédex", selection: $filter.scope) {
                                Text(model.dex["regionalLabel"].string.nonempty ?? "Regional").tag("regional")
                                Text("National").tag("national")
                            }.labelsHidden().accessibilityLabel("Pokédex scope")
                            Picker("Type", selection: $filter.type) { Text("All types").tag("any"); ForEach(types, id: \.self) { Text($0.capitalized).tag($0) } }.labelsHidden().accessibilityLabel("Pokémon type")
                        }
                        HStack {
                            if banked {
                                Picker("Owned", selection: $filter.ownership) {
                                    Text("Owned or not").tag("all"); Text("Owned").tag("owned"); Text("Shiny owned").tag("shiny"); Text("Not owned").tag("missing")
                                }.labelsHidden().accessibilityLabel("Ownership")
                                Picker("Route", selection: $filter.availability) {
                                    Text("Any route").tag("all"); Text("Obtainable in FireRed").tag("obtainable"); Text("Needs another game").tag("external")
                                }.labelsHidden().accessibilityLabel("How FireRed gets it")
                            } else {
                                Picker("Availability", selection: $filter.availability) {
                                    Text("All Pokémon").tag("all")
                                    Text("Encounter or gift").tag("encounter")
                                    Text("Other acquisition").tag("other")
                                }.labelsHidden().accessibilityLabel("Pokémon availability")
                            }
                        }
                    }.padding(12)
                    List(selection: $model.selectedSpecies) {
                        ForEach(filtered, id: \.gameID) { pokemon in
                            Button { model.selectedSpecies = pokemon["id"].int } label: { row(pokemon) }.buttonStyle(.plain).tag(pokemon["id"].int)
                        }
                    }.listStyle(.inset).scrollContentBackground(.hidden).overlay { if filtered.isEmpty { ContentUnavailableView.search(text: filter.query) } }
                    footer
                }.padding(12)
            } trailing: {
                VStack(spacing: 0) {
                    let mon = model.chosenPokemon
                    let entry = entries[mon["id"].int] ?? .null
                    HStack(spacing: 16) {
                        ROMSprite(id: mon["id"].int, shiny: shiny, size: 88)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(mon["name"].string).font(.title2.weight(.semibold))
                            Text(mon["types"].array.map { $0.string.capitalized }.joined(separator: " / ")).foregroundStyle(.secondary)
                            if banked, !entry.isNull {
                                Text("\(entry["route"]["label"].string) · \(entry["route"]["detail"].string)").font(.callout).foregroundStyle(.secondary)
                                    .lineLimit(2).help(entry["route"]["detail"].string).accessibilityIdentifier("bank-route")
                                Text(BankIndex.ownership(entry) ?? "Not in any save").font(.callout).accessibilityIdentifier("bank-ownership")
                            }
                            Toggle("Shiny", isOn: $shiny).toggleStyle(.checkbox)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 12) {
                            Text(String(format: "No. %03d", mon["id"].int)).font(.callout).foregroundStyle(.secondary)
                            if banked {
                                Button("Get It…") { gettingIt = true }.buttonStyle(.borderedProminent).disabled(entry.isNull)
                                    .help("Choose shiny, nature, IVs and more; the bot gets it through a goal, like Ask").accessibilityIdentifier("bank-get-it")
                                Button("Competitive Build…") { building = CompetitiveBuilderRequest(speciesID: mon["id"].int) }
                                    .help("Suggested sets for this species, and how to build one legitimately").accessibilityIdentifier("bank-competitive-build")
                            } else {
                                Button("Set Up Hunt") { model.page = .farming }.buttonStyle(.borderedProminent)
                            }
                            if model.state["artwork"][model.selectedGame]["artwork"].string != "local-rom" {
                                Button("Artwork") { artworkInfo = true }.popover(isPresented: $artworkInfo) { ArtworkCoverage(game: model.selectedGame).padding(16).frame(width: 320) }
                            }
                        }
                    }.padding(16)
                    SectionTabs(label: "Bank details", items: sections, selection: $section)
                    if section == "Moves" { TextField("Search moves", text: $moveSearch).textFieldStyle(.roundedBorder).padding(.horizontal, 16).padding(.bottom, 12) }
                    TitledScroll(title: section) {
                        if section == "Owned" { ownedList(mon) }
                        else if section == "Overview" {
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
                                if mon["encounters"].array.isEmpty { Text(banked ? "No wild encounters. Get It shows the bot’s route." : "No wild encounters. Preview a hunt for other routes.").foregroundStyle(.secondary) }
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
                                if !banked { Button("Plan Acquisition") { model.page = .farming }.help("Preview a hunt to check game access, items and any required trades") }
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
                    }.padding([.horizontal, .bottom], 12)
                }
            }
            .onChange(of: model.selectedSpecies) { _, _ in moveSearch = ""; owned = .null }
            .task(id: model.dex["game"].string) {
                filter = PokedexFilter(scope: model.dex["defaultDex"].string == "regional" ? "regional" : "national")
                if !sections.contains(section) { section = sections[0] }
                if !filtered.contains(where: { $0["id"].int == model.selectedSpecies }), let first = filtered.first { model.selectedSpecies = first["id"].int }
            }
            // Every save is read on the host (cached until a save changes); the selected species' individuals refresh more often for trade state.
            .task(id: model.selectedGame) {
                bank = .null; issue = nil
                guard banked else { return }
                while !Task.isCancelled { await loadBank(); do { try await Task.sleep(for: .seconds(30)) } catch { return } }
            }
            .task(id: "\(model.selectedGame):\(model.selectedSpecies)") {
                guard banked else { return }
                while !Task.isCancelled { await loadOwned(); do { try await Task.sleep(for: .seconds(10)) } catch { return } }
            }
            .competitiveBuilder($building)
            .sheet(item: Binding(get: { inspecting.map(BankInspection.init) }, set: { inspecting = $0?.mon })) { item in
                BankIndividualSheet(mon: item.mon, owned: owned) { inspecting = nil }
            }
            .sheet(isPresented: $gettingIt) {
                let mon = model.chosenPokemon
                VStack(spacing: 0) {
                    BankGetItView(mon: mon, route: entries[mon["id"].int]?["route"] ?? .null, flow: model.bankRequests)
                    HStack { Spacer(); Button("Done") { gettingIt = false }.keyboardShortcut(.defaultAction) }.padding(12).background(.bar)
                }.suiteSheetSize(width: 560, height: 700)
            }
        }
    }

    private func row(_ pokemon: JSONValue) -> some View {
        let entry = entries[pokemon["id"].int] ?? .null
        return HStack {
            ROMSprite(id: pokemon["id"].int, size: 32).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(pokemon["name"].string)
                if banked, let label = entry["route"]["label"].string.nonempty { Text(label).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
            if entry["shiny"].int > 0 { Image(systemName: "sparkles").foregroundStyle(.orange).font(.caption).accessibilityLabel("Shiny owned") }
            if entry["owned"].int > 0 { Text("×\(entry["owned"].int)").font(.caption.weight(.medium)).monospacedDigit().accessibilityLabel("\(entry["owned"].int) owned") }
            Text(String(format: "%03d", filter.number(pokemon))).font(.caption).foregroundStyle(.secondary)
        }.contentShape(Rectangle())
    }

    @ViewBuilder private var footer: some View {
        if banked {
            HStack(spacing: 6) {
                if bank.isNull && issue == nil { ProgressView().controlSize(.small); Text("Reading every save…") }
                else if let issue { Label(issue, systemImage: "exclamationmark.circle").lineLimit(2) }
                else {
                    Text("\(bank["totals"]["owned"].int) of \(bank["totals"]["species"].int) species owned · \(bank["totals"]["shiny"].int) with a shiny")
                }
                Spacer(minLength: 4)
                Text("\(filtered.count)").accessibilityLabel("\(filtered.count) Pokémon shown")
                if !bank.isNull { InfoButton(title: "Saves in the Bank", message: savesSummary) }
            }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 12).padding(.vertical, 8)
        } else {
            HStack { Spacer(); Text("\(filtered.count)").accessibilityLabel("\(filtered.count) Pokémon") }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 12).padding(.vertical, 8)
        }
    }

    private var savesSummary: String {
        let lines = bank["saves"].array.map { save in
            save["status"].string == "valid" ? "\(save["label"].string): \(save["count"].int) Pokémon" + (save["active"].bool ? " (current game)" : "")
                : "\(save["label"].string): unavailable. \(save["reason"].string)"
        }
        return (lines + ["Every save is read, never changed. Only the current game can send a Pokémon to the Switch."]).joined(separator: "\n")
    }

    @ViewBuilder private func ownedList(_ mon: JSONValue) -> some View {
        let pokemon = BankIndex.individuals(owned)
        VStack(alignment: .leading, spacing: 10) {
            if owned.isNull { ProgressView("Reading every save…").frame(maxWidth: .infinity) }
            else if pokemon.isEmpty {
                Text("No \(mon["name"].string) in any save the app knows.").foregroundStyle(.secondary)
                Text("Get It asks the bot to catch one.").font(.callout).foregroundStyle(.secondary)
            } else {
                ForEach(pokemon, id: \.bankRowID) { individual in
                    Button { inspecting = individual } label: {
                        HStack(spacing: 12) {
                            ROMAsset(kind: "pokemon", key: individual["nationalSpeciesId"].text, shiny: individual["shiny"].bool, size: 40, label: individual["name"].string)
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 4) {
                                    Text(individual["nickname"].string.nonempty ?? individual["name"].string).fontWeight(.medium)
                                    if individual["shiny"].bool { Image(systemName: "sparkles").foregroundStyle(.orange).font(.caption).accessibilityLabel("Shiny") }
                                    if individual["isEgg"].bool { Text("Egg").font(.caption).foregroundStyle(.secondary) }
                                }
                                Text(BankIndividualSheet.facts(individual)).font(.caption).foregroundStyle(.secondary).monospacedDigit()
                                Text(BankIndex.whereHeld(individual)).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                        }.contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityHint("Inspect")
                    Divider()
                }
            }
        }.accessibilityIdentifier("bank-owned")
    }

    private func loadBank() async {
        guard let api = model.api else { return }
        let game = model.selectedGame
        do {
            let value = try await api.get("/api/pokemon-suite/bank?game=\(game)")
            guard !Task.isCancelled, model.selectedGame == game else { return }
            bank = value; issue = nil
        } catch { if model.selectedGame == game { issue = error.localizedDescription } }
    }

    private func loadOwned() async {
        guard let api = model.api else { return }
        let game = model.selectedGame, species = model.selectedSpecies
        do {
            let value = try await api.get("/api/pokemon-suite/bank?game=\(game)&species=\(species)")
            guard !Task.isCancelled, model.selectedGame == game, model.selectedSpecies == species else { return }
            owned = value
            if let shown = inspecting, let fresh = BankIndex.individuals(value).first(where: { $0.bankRowID == shown.bankRowID }) { inspecting = fresh }
        } catch {}
    }

    private func evolutionButton(_ pokemon: JSONValue, condition: String) -> some View {
        Button {
            filter.query = ""; filter.type = "any"; filter.availability = "all"; filter.ownership = "all"
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

private struct BankInspection: Identifiable {
    let mon: JSONValue
    var id: String { mon.bankRowID }
}

/// Inspect: the Trading detail view for one owned individual, with Send to Switch from the current game.
struct BankIndividualSheet: View {
    @EnvironmentObject var model: SuiteModel
    let mon: JSONValue
    /// The species' Bank response (its current game's trade state).
    let owned: JSONValue
    let done: () -> Void
    @State private var section = "Overview"
    @State private var confirm = false
    @State private var building: CompetitiveBuilderRequest?
    private var activeTrade: Bool { !owned["trade"]["phase"].string.isEmpty && !["complete", "cancelled"].contains(owned["trade"]["phase"].string) }

    /// "Lv. 20 · Timid · IVs 31/30/29/28/27/26"
    static func facts(_ mon: JSONValue) -> String {
        [mon["level"].int > 0 ? "Lv. \(mon["level"].int)" : nil, mon["natureName"].string.nonempty, "IVs " + BankIndex.ivs(mon)].compactMap { $0 }.joined(separator: " · ")
    }

    var body: some View {
        VStack(spacing: 0) {
            PokemonIndividualDetail(mon: mon, section: $section)
            VStack(alignment: .leading, spacing: 10) {
                if activeTrade {
                    Text("A trade is in progress. Follow it in Trading.").font(.callout).foregroundStyle(.secondary)
                } else if let reason = mon["tradeReason"].string.nonempty {
                    Text(reason).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                HStack {
                    Button("Send to Switch", systemImage: "antenna.radiowaves.left.and.right") { confirm = true }
                        .buttonStyle(.borderedProminent).disabled(!mon["canPrepare"].bool || !mon["isActiveSave"].bool || activeTrade || model.busy)
                        .accessibilityIdentifier("bank-send-to-switch")
                    Button("Competitive Build…") { building = CompetitiveBuilderRequest(pokemon: mon, sourceID: mon["sourceId"].string) }
                        .accessibilityIdentifier("bank-individual-competitive-build")
                    Spacer()
                    Button("Done", action: done).keyboardShortcut(.defaultAction)
                }
            }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(.bar).overlay(alignment: .top) { Divider() }
        }
        .suiteSheetSize(width: 480, height: 600)
        .competitiveBuilder($building)
        .confirmationDialog("Send \(mon["name"].string) to the Switch?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Prepare Trade") { send() }
        } message: { Text("Retrieve this Pokémon, heal and save, then open a Direct Corner lobby as Leader. The trade continues in Trading.") }
    }

    /// The existing trade flow: trade-plan, check-radio, then trade-pokemon (SuiteModel.prepareOwnedTrade opens Trading).
    private func send() {
        let game = model.selectedGame
        model.perform {
            let plan = (try await model.api?.post("/api/pokemon-suite/trade-plan", .object(["game": .string(game), "pokemonId": mon["id"], "sourceId": mon["sourceId"]])) ?? .null)["plan"]
            try await model.prepareOwnedTrade(plan)
            done()
        }
    }
}

extension JSONValue {
    /// One individual in one save (the same Pokémon can be in several saves).
    var bankRowID: String { self["sourceId"].string + ":" + self["slotId"].string }
}

func statName(_ stat: String) -> String {
    ["hp":"HP","attack":"Attack","defense":"Defense","specialAttack":"Sp. Attack","specialDefense":"Sp. Defense","speed":"Speed","special":"Special"][stat] ?? stat
}
