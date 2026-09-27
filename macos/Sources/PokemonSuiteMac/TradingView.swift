import SwiftUI
import AppKit
import SuiteCore
import UniformTypeIdentifiers

struct TradingView: View {
    @EnvironmentObject private var model: SuiteModel
    @State private var inventory: JSONValue = .null
    @State private var filter = PCInventoryFilter()
    @State private var selectedID: String?
    @State private var loading = true
    @State private var issue: String?
    @State private var confirmTrade = false
    @State private var sourceRevision = 0
    @State private var changingSource = false
    @State private var showingConnection = false
    @State private var detailSection = "Overview"
    @AppStorage("pc-inventory-appearance") private var savedAppearance = "all"
    private var pokemon: [JSONValue] { inventory["pokemon"].array }
    private var visible: [JSONValue] { pokemon.filter(filter.includes) }
    private var selected: JSONValue? { pokemon.first { $0["id"].string == selectedID } }
    private var types: [String] { Array(Set(pokemon.flatMap { $0["types"].array.map(\.string) })).sorted() }
    private var radio: JSONValue { inventory["radio"] }
    private var trade: JSONValue { inventory["trade"] }
    private var activeTrade: Bool { !trade["phase"].string.isEmpty && !["complete", "cancelled"].contains(trade["phase"].string) }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Picker("Save", selection: Binding(get: { inventory["sourceId"].string.nonempty ?? "current" }, set: chooseSource)) {
                    if inventory["sources"].array.isEmpty { Text("Current game").tag("current") }
                    ForEach(inventory["sources"].array, id: \.inventorySourceID) { Text($0["label"].string).tag($0["id"].string) }
                }.frame(maxWidth: 600).accessibilityIdentifier("trading-save")
                    .disabled(model.busy || changingSource)
                if changingSource { ProgressView().controlSize(.small) }
                Spacer(minLength: 0)
                Button { showingConnection.toggle() } label: {
                    Label("Wireless", systemImage: "antenna.radiowaves.left.and.right")
                        .foregroundStyle(radio["ready"].bool ? Color.green : .primary)
                }.popover(isPresented: $showingConnection) { connectionDetails }
                Menu {
                    Button("Add Saved Game…", action: addSavedGame)
                    Button("Refresh") { Task { await reload() } }
                } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("Save options")
                    .disabled(model.busy || changingSource)
            }.padding(.horizontal, 16).padding(.vertical, 10)
            Divider()
            if inventory != .null, !radio["ready"].bool, let reason = radio["reason"].string.nonempty {
                HStack(alignment: .center, spacing: 10) {
                    if radio["state"].string == "checking" { ProgressView().controlSize(.small) }
                    else { Image(systemName: "antenna.radiowaves.left.and.right").foregroundStyle(.secondary) }
                    Text(reason).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    if radio["state"].string == "keys-missing" {
                        Button("Choose Console Keys…", action: chooseRadioKeys).disabled(model.busy)
                    }
                }.padding(.horizontal, 16).padding(.vertical, 10)
                Divider()
            }
            if loading && inventory == .null {
                ProgressView("Reading Pokémon…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if !inventory["supported"].bool || inventory["validity"].string != "valid" {
                ContentUnavailableView {
                    Label("Inventory unavailable", systemImage: "externaldrive.badge.questionmark")
                } description: { Text(issue ?? inventory["reason"].string.nonempty ?? "This save could not be read.") }
                actions: { Button("Refresh") { Task { await reload() } } }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                SuiteSplit(leadingFraction: 0.65) {
                    VStack(spacing: 0) {
                        filters
                        BorderedScroll {
                            VStack(alignment: .leading, spacing: 12) {
                                HStack {
                                    Text(filter.location == "all" ? "Pokémon" : filter.location == "party" ? "Party" : "Box \((Int(filter.location) ?? 0) + 1)").font(.headline)
                                    Spacer()
                                    if let box = Int(filter.location) {
                                        Button { filter.location = String(max(0, box - 1)) } label: { Image(systemName: "chevron.left") }.disabled(box == 0).accessibilityLabel("Previous box")
                                        Button { filter.location = String(min(13, box + 1)) } label: { Image(systemName: "chevron.right") }.disabled(box == 13).accessibilityLabel("Next box")
                                    }
                                }
                                if let box = Int(filter.location) {
                                    LazyVGrid(columns: columns, spacing: 6) {
                                        ForEach(0..<30, id: \.self) { slot in
                                            if let mon = pokemon.first(where: { $0["location"]["kind"].string == "box" && $0["location"]["box"].int == box && $0["location"]["slot"].int == slot }) {
                                                if filter.includes(mon) { cell(mon) } else { vacant(slot: slot, filtered: true) }
                                            } else { vacant(slot: slot) }
                                        }
                                    }
                                } else if visible.isEmpty {
                                    ContentUnavailableView("No matches", systemImage: "line.3.horizontal.decrease")
                                    Button("Clear Filters") { filter = PCInventoryFilter() }
                                } else {
                                    LazyVGrid(columns: columns, spacing: 6) {
                                        ForEach(visible, id: \.inventorySlotID) { cell($0) }
                                    }
                                }
                            }
                        }
                        HStack {
                            Text("\(visible.count) of \(pokemon.count) Pokémon")
                            Spacer()
                            Text("\(pokemon.filter { $0["shiny"].bool }.count) shiny")
                        }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 12).padding(.vertical, 8)
                    }
                } trailing: {
                    VStack(spacing: 0) {
                        if let selected {
                            HStack(spacing: 12) {
                                ROMAsset(kind: "pokemon", key: selected["nationalSpeciesId"].text, shiny: selected["shiny"].bool, size: 80, label: selected["name"].string)
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(selected["name"].string).font(.title3.weight(.semibold))
                                    Text(selected["types"].array.map { $0.string.capitalized }.joined(separator: " / ")).font(.callout).foregroundStyle(.secondary)
                                    if selected["shiny"].bool { Label("Shiny", systemImage: "sparkles").font(.caption).foregroundStyle(.orange) }
                                }
                                Spacer(minLength: 0)
                            }.padding(16)
                            SectionTabs(label: "Pokémon details", items: ["Overview", "Stats", "Moves"], selection: $detailSection)
                            BorderedScroll { detail(selected) }
                        } else {
                            ContentUnavailableView("Select a Pokémon", systemImage: "cursorarrow.click").frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                        tradeFooter
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .task(id: model.selectedGame) {
            sourceRevision += 1; inventory = .null; selectedID = nil; filter.location = "all"; filter.appearance = savedAppearance; loading = true
            while !Task.isCancelled { await reload(); do { try await Task.sleep(for: .seconds(5)) } catch { return } }
        }
        .onChange(of: filter.appearance) { _, value in savedAppearance = value }
        .onChange(of: visible.map { $0["id"].string }) { _, ids in if let selectedID, !ids.contains(selectedID) { self.selectedID = nil } }
        .confirmationDialog("Trade \(selected?["name"].string ?? "this Pokémon")?", isPresented: $confirmTrade, titleVisibility: .visible) {
            Button("Prepare Trade") { if let selected { startTrade(selected) } }
        } message: { Text(inventory["isActiveSave"].bool ? "Retrieve this Pokémon, heal and save, then open a Direct Corner lobby as Leader." : "Load this saved game, retrieve the Pokémon, heal and save, then open a Direct Corner lobby as Leader. Your current run stays saved.") }
    }
    private var columns: [GridItem] { Array(repeating: GridItem(.flexible(), spacing: 6), count: 6) }
    private var filters: some View {
        VStack(spacing: 10) {
            TextField("Search Pokémon", text: $filter.query).textFieldStyle(.roundedBorder).accessibilityIdentifier("trading-search")
            HStack(spacing: 10) {
                Picker("Appearance", selection: $filter.appearance) { Text("All").tag("all"); Text("Shiny").tag("shiny"); Text("Not shiny").tag("normal") }.pickerStyle(.segmented).labelsHidden().frame(maxWidth: 225)
                Picker("Location", selection: $filter.location) {
                    Text("All locations").tag("all"); Text("Party").tag("party")
                    ForEach(inventory["boxes"].array, id: \.boxNumber) { Text("\($0["name"].string) (\($0["used"].int)/30)").tag(String($0["box"].int)) }
                }.labelsHidden()
                Picker("Type", selection: $filter.type) { Text("All types").tag("all"); ForEach(types, id: \.self) { Text($0.capitalized).tag($0) } }.labelsHidden().frame(maxWidth: 130)
            }
        }.padding(12)
    }
    private func cell(_ mon: JSONValue) -> some View {
        Button { selectedID = mon["id"].string } label: {
            VStack(spacing: 2) {
                ZStack(alignment: .topTrailing) {
                    ROMAsset(kind: "pokemon", key: mon["nationalSpeciesId"].text, shiny: mon["shiny"].bool, size: 48, label: mon["name"].string)
                    if mon["shiny"].bool { Image(systemName: "sparkles").foregroundStyle(.orange).font(.caption2) }
                }
                Text(mon["nickname"].string.nonempty ?? mon["name"].string).font(.system(size: 12, weight: .medium)).lineLimit(1)
            }.frame(maxWidth: .infinity).frame(height: 80)
                .background(selectedID == mon["id"].string ? Color.accentColor.opacity(0.13) : Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
                .overlay { RoundedRectangle(cornerRadius: 6).stroke(selectedID == mon["id"].string ? Color.accentColor : Color(nsColor: .separatorColor), lineWidth: selectedID == mon["id"].string ? 2 : 1) }
        }.buttonStyle(.plain).help("\(mon["name"].string), \(location(mon))")
            .accessibilityLabel("\(mon["name"].string), \(mon["shiny"].bool ? "shiny, " : "")\(location(mon))")
            .accessibilityIdentifier("pc-" + mon["slotId"].string)
    }
    private func vacant(slot: Int, filtered: Bool = false) -> some View {
        Text(filtered ? "—" : String(slot + 1)).font(.caption).foregroundStyle(.tertiary)
            .frame(maxWidth: .infinity).frame(height: 80)
            .overlay { RoundedRectangle(cornerRadius: 6).stroke(Color(nsColor: .separatorColor).opacity(0.55)) }
            .accessibilityLabel("Slot \(slot + 1), \(filtered ? "filtered" : "empty")")
    }
    @ViewBuilder private func detail(_ mon: JSONValue) -> some View {
        if detailSection == "Overview" {
            VStack(alignment: .leading, spacing: 14) {
                LabeledContent("Location", value: location(mon))
                if mon["level"].int > 0 { LabeledContent("Level", value: mon["level"].text) }
                if let nature = mon["natureName"].string.nonempty { LabeledContent("Nature", value: nature) }
                if let ability = mon["ability"].string.nonempty { LabeledContent("Ability", value: ability) }
                LabeledContent("Held item", value: mon["heldItem"].int == 0 ? "None" : CartridgeItem.name(nativeID: mon["heldItem"].int, catalog: model.dex["heldItems"].array) ?? "Item \(mon["heldItem"].int)")
            }
        } else if detailSection == "Stats" {
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
    private var tradeFooter: some View {
        VStack(alignment: .leading, spacing: 10) {
            if trade["phase"].string == "cancelled" {
                Text(trade["reason"].string.nonempty ?? "Trade cancelled. Choose another Pokémon.").font(.callout).foregroundStyle(.secondary)
            }
            if activeTrade {
                Text(trade["reason"].string.nonempty ?? trade["phase"].string).font(.callout)
                Button("Stop Lobby") { stopTrade() }.disabled(model.busy || trade["exchangeStarted"].bool)
                Button("Show Game") { model.page = .live }
            } else if let phase = inventory["preparation"]["phase"].string.nonempty, phase != "ready" {
                Text(["party":"Retrieving Pokémon…", "healing":"Healing the team…", "saving":"Saving…"][phase] ?? phase).font(.callout)
                Button("Stop Preparation") { stopTrade() }.disabled(model.busy)
            } else if let selected {
                if let reason = selected["tradeReason"].string.nonempty {
                    HStack(alignment: .top) {
                        Text(inventory["isActiveSave"].bool ? reason : "Loads this save for trading.").font(.callout).foregroundStyle(.secondary).lineLimit(2)
                        Spacer(minLength: 0)
                        InfoButton(title: "Trade availability", message: reason)
                    }
                }
                Button("Prepare Trade", systemImage: "antenna.radiowaves.left.and.right") { confirmTrade = true }
                    .buttonStyle(.borderedProminent).disabled(!selected["canPrepare"].bool || model.busy || changingSource || issue != nil)
            }
            if let issue { Text(issue).font(.callout).foregroundStyle(.red) }
            HStack {
                Text(inventory["isActiveSave"].bool ? "Current game" : "Saved collection").font(.caption).foregroundStyle(.secondary)
                Spacer()
                InfoButton(title: "Save details", message: inventory["saveLabel"].string + "\n" + (ISO8601DateFormatter.fractional.date(from: inventory["save"]["updatedAt"].string)?.formatted(date: .abbreviated, time: .shortened) ?? "") + "\nBrowsing leaves the save unchanged.")
            }
        }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(.bar).overlay(alignment: .top) { Divider() }
    }
    private var connectionDetails: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Wireless trading").font(.headline)
            Label(radio["ready"].bool ? "Adapter connected" : radio["state"].string == "checking" ? "Connecting…" : "Wireless unavailable", systemImage: radio["ready"].bool ? "checkmark.circle" : "antenna.radiowaves.left.and.right")
            if let reason = radio["reason"].string.nonempty { Text(reason).font(.callout).foregroundStyle(.secondary) }
            Button("Choose Console Keys…", action: chooseRadioKeys).disabled(model.busy)
        }.padding(16).frame(width: 310)
    }
    private func location(_ mon: JSONValue) -> String {
        let p = mon["location"]
        return p["kind"].string == "party" ? "Party \(p["slot"].int + 1)" : "Box \(p["box"].int + 1), slot \(p["slot"].int + 1)"
    }
    private func reload() async {
        guard let api = model.api, !changingSource else { return }
        let game = model.selectedGame, revision = sourceRevision
        do {
            let result = try await api.get("/api/pokemon-suite/inventory?game=\(game)")
            guard !Task.isCancelled, model.selectedGame == game, sourceRevision == revision else { return }
            inventory = result; issue = nil; loading = false
            if let selectedID, !pokemon.contains(where: { $0["id"].string == selectedID }) { self.selectedID = nil }
        } catch { guard model.selectedGame == game, sourceRevision == revision else { return }; issue = error.localizedDescription; loading = false }
    }
    private func chooseSource(_ identifier: String) {
        changeSource(path: "/api/pokemon-suite/inventory-source", field: "sourceId", value: identifier)
    }
    private func addSavedGame() {
        let panel = NSOpenPanel()
        panel.title = "Choose a saved Pokémon Suite game"
        panel.message = "Choose a saved-game record or its current.json checkpoint. The collection will be linked for browsing."
        panel.allowedContentTypes = [.json]; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
        panel.directoryURL = model.profile.appendingPathComponent("\(model.selectedGame)/save-profiles")
        guard let window = NSApp.keyWindow else { return }
        panel.beginSheetModal(for: window) { response in
            if response == .OK, let url = panel.url { changeSource(path: "/api/pokemon-suite/inventory-sources", field: "path", value: url.path) }
        }
    }
    private func changeSource(path: String, field: String, value: String) {
        guard !changingSource else { return }
        let game = model.selectedGame
        sourceRevision += 1; changingSource = true
        Task {
            do {
                try await model.api?.post(path, .object(["game": .string(game), field: .string(value)]))
                changingSource = false
                guard model.selectedGame == game else { return }
                selectedID = nil; filter.location = "all"; filter.query = ""
                await reload()
            } catch { changingSource = false; if model.selectedGame == game { issue = error.localizedDescription } }
        }
    }
    private func chooseRadioKeys() {
        let panel = NSOpenPanel()
        panel.title = "Choose your console key file"
        panel.message = "The wireless relay uses these locally while trading. They are not included in the app or uploaded."
        panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
        guard let window = NSApp.keyWindow else { return }
        let game = model.selectedGame
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else { return }
            model.perform {
                try await model.api?.post("/api/pokemon-suite/radio-settings", .object(["game": .string(game), "keysPath": .string(url.path)]))
                if model.selectedGame == game { await reload() }
            }
        }
    }
    private func startTrade(_ mon: JSONValue) {
        let game = model.selectedGame, source = inventory["sourceId"].string
        model.perform {
            let plan = (try await model.api?.post("/api/pokemon-suite/trade-plan", .object(["game": .string(game), "pokemonId": mon["id"], "sourceId": .string(source)])) ?? .null)["plan"]
            try await model.prepareOwnedTrade(plan)
            await reload()
        }
    }
    private func stopTrade() {
        let game = model.selectedGame
        model.perform { try await model.api?.post("/api/pokemon-suite/stop-trade", .object(["game": .string(game)])); await reload() }
    }
}

private extension JSONValue {
    var inventorySourceID: String { self["id"].string }
    var inventorySlotID: String { self["slotId"].string }
    var boxNumber: Int { self["box"].int }
}
private extension ISO8601DateFormatter {
    static var fractional: ISO8601DateFormatter { let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return formatter }
}
