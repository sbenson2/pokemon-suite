import SwiftUI
import SuiteCore

struct FarmingView: View {
    @EnvironmentObject var model: SuiteModel
    @State private var choosingSpecies = false
    @State private var choosingMoves = false
    @State private var section = "Catch"
    @State private var activitySection = "Plan"
    @State private var draft = HuntDraft(defaults: .null)
    @State private var loadedDraft: HuntDraft?
    @State private var loadedKey = ""
    @State private var draftReady = false
    @State private var reviewID: String?
    @State private var queueError: String?
    @State private var preview: JSONValue = .null
    @State private var requests: [JSONValue] = []
    var generation: Int { model.dex["generation"].int }
    var draftKey: String { model.selectedGame + ":" + String(model.selectedSpecies) }
    var reviewedRecord: JSONValue { requests.first { $0["id"].string == reviewID } ?? .null }
    var request: JSONValue { draft.request(game: model.selectedGame, speciesID: model.selectedSpecies, generation: generation) }
    var validation: String? {
        if !draft.nickname.isEmpty && draft.nickname.range(of: "^[A-Za-z]{1,10}$", options: .regularExpression) == nil { return "Use up to 10 letters for a nickname, or leave it blank." }
        if draft.maximumLevel < draft.minimumLevel { return "Maximum encounter level must be at least the minimum level." }
        if draft.finalLevel > 0 && draft.finalLevel < draft.minimumLevel { return "Final level must be at least the minimum encounter level." }
        if draft.maxIvs.contains(where: { $0.value < (draft.ivs[$0.key] ?? 0) }) { return "Each maximum IV must be at least its minimum." }
        return limitIssue(request["limits"])
    }
    var body: some View {
        if model.species.isEmpty { ContentUnavailableView("Hunting unavailable", systemImage: "scope") }
        else {
            SuiteSplit(leadingFraction: 0.58) {
                VStack(spacing: 0) {
                    HStack(spacing: 12) {
                        ROMSprite(id: model.selectedSpecies, shiny: draft.shiny, size: 56)
                        Button(model.chosenPokemon["name"].string + "…") { choosingSpecies = true }
                            .accessibilityIdentifier("choose-species").help("Choose Pokémon")
                        Spacer()
                        Toggle("Shiny required", isOn: $draft.shiny).toggleStyle(.checkbox)
                            .help("Every shiny encounter is protected, regardless of the other requirements")
                            .disabled(!draftReady)
                    }.padding(.horizontal, 16).padding(.vertical, 10)
                    SectionTabs(label: "Hunt settings", items: ["Catch", "Traits", "Training", "Limits", "Build"], selection: $section)
                    Form {
                        Group {
                        if section == "Catch" {
                            Section {
                                Stepper("Quantity: \(draft.quantity)", value: $draft.quantity, in: 1...99)
                                #if os(iOS)
                                TextField("Nickname", text: $draft.nickname, prompt: Text("Nickname (optional)"))
                                #else
                                TextField("Nickname", text: $draft.nickname, prompt: Text("Optional"))
                                #endif
                                Picker("Location", selection: $draft.location) {
                                    Text("Fastest route").tag("any")
                                    ForEach(model.chosenPokemon["encounters"].array, id: \.gameID) { Text($0["location"].string + " (" + $0["method"].string + ")").tag($0["id"].string) }
                                }
                                Picker("Poké Ball", selection: $draft.ball) { Text("Bot chooses").tag("any"); ForEach(model.dex["balls"].array, id: \.gameID) { Text($0.label).tag($0["id"].string) } }
                                if draft.ball != "any" { Toggle("Require this ball", isOn: $draft.strictBall) }
                                Picker("After catch", selection: $draft.tradeAfter) { Text("Save").tag(false); Text("Prepare trade").tag(true) }
                            }
                        } else if section == "Traits" {
                            Section {
                                if generation >= 3 {
                                    LabeledContent("Natures") {
                                        Menu(draft.natures.isEmpty ? "Any" : draft.natures.map { $0.capitalized }.joined(separator: ", ")) {
                                            Button("Any nature") { draft.natures = [] }
                                            Divider()
                                            ForEach(model.dex["natures"].array, id: \.gameID) { nature in
                                                Toggle(nature.label, isOn: Binding(get: { draft.natures.contains(nature["id"].string) }, set: { selected in
                                                    if selected { draft.natures.append(nature["id"].string) }
                                                    else { draft.natures.removeAll { $0 == nature["id"].string } }
                                                }))
                                            }
                                        }.accessibilityLabel("Acceptable natures")
                                    }
                                    Picker("Ability", selection: $draft.ability) { Text("Any").tag(0); ForEach(model.chosenPokemon["abilities"].array, id: \.gameID) { Text($0.label).tag($0["id"].int) } }
                                }
                                Picker("Gender", selection: $draft.gender) { ForEach(["any","male","female","genderless"], id: \.self) { Text($0.capitalized).tag($0) } }
                            }
                            Section(generation == 2 ? "Minimum DVs" : "IV ranges") {
                                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                                    ForEach(generation == 2 ? ["attack","defense","special","speed"] : ["hp","attack","defense","specialAttack","specialDefense","speed"], id: \.self) { stat in
                                        VStack(alignment: .leading) {
                                            Text(statName(stat)).font(.callout)
                                            Stepper("Minimum: \((generation == 2 ? draft.dvs[stat] : draft.ivs[stat]) ?? 0)", value: Binding(get: { (generation == 2 ? draft.dvs[stat] : draft.ivs[stat]) ?? 0 }, set: { if generation == 2 { draft.dvs[stat] = $0 } else { draft.ivs[stat] = $0 } }), in: 0...(generation == 2 ? 15 : 31))
                                            if generation >= 3 { Stepper("Maximum: \(draft.maxIvs[stat] ?? 31)", value: Binding(get: { draft.maxIvs[stat] ?? 31 }, set: { draft.maxIvs[stat] = $0 }), in: 0...31) }
                                        }
                                    }
                                }
                            }
                        } else if section == "Training" {
                            Section("Level") {
                                Stepper("Minimum encounter level: \(draft.minimumLevel)", value: $draft.minimumLevel, in: 1...100)
                                Stepper("Maximum encounter level: \(draft.maximumLevel)", value: $draft.maximumLevel, in: 1...100)
                                Stepper(draft.finalLevel == 0 ? "Final level: unchanged" : "Final level: \(draft.finalLevel)", value: $draft.finalLevel, in: 0...100)
                            }
                            Section {
                                Picker("Held item", selection: $draft.heldItem) { Text("None").tag(0); ForEach(model.dex["heldItems"].array, id: \.gameID) { Text($0.label).tag($0["id"].int) } }
                                LabeledContent("Moves") { Button(draft.moveIDs.isEmpty ? "Choose…" : "\(draft.moveIDs.count) selected…") { choosingMoves = true } }
                                if !draft.moveIDs.isEmpty { Text(model.dex["moves"].array.filter { draft.moveIDs.contains($0["id"].int) }.map(\.label).joined(separator: ", ")).font(.callout).foregroundStyle(.secondary) }
                            }
                        } else if section == "Build" { CompetitiveBuildView(attached: $draft.competitive) }
                        else {
                            Section {
                                TextField("Maximum minutes", value: $draft.minutes, format: .number)
                                TextField("Maximum encounters", value: $draft.encounters, format: .number)
                                TextField("Balls in reserve", value: $draft.reserve, format: .number)
                                TextField("Maximum spending", value: $draft.spend, format: .number)
                            }
                        }
                        }
                        #if os(iOS)
                        .listRowBackground(GameFormRowBackground())
                        #endif
                    }.formStyle(.grouped).disabled(!draftReady).overlay(Rectangle().stroke(.separator, lineWidth: 1))
                    VStack(alignment: .leading, spacing: 8) {
                        if let validation { Label(validation, systemImage: "exclamationmark.circle").font(.callout) }
                        else if !model.installed { Text("Add this game to start hunting.").font(.callout).foregroundStyle(.secondary) }
                        HStack {
                            Button("Preview") { previewHunt() }.accessibilityLabel("Preview Hunt")
                            Button("Queue") { queue(start: false); activitySection = "Queue" }.accessibilityLabel("Queue Hunt")
                            Spacer()
                            Button(HuntWorkflow.startLabel(plan: preview, record: reviewedRecord)) { queue(start: true) }.buttonStyle(.borderedProminent)
                                .disabled(!model.installed || !preview.isNull && !HuntWorkflow.canStart(plan: preview, record: reviewedRecord))
                        }.disabled(model.busy || !draftReady || validation != nil)
                    }.padding(12).background(.bar)
                }
            } trailing: {
                VStack(spacing: 0) {
                    SectionTabs(label: "Hunt activity", items: ["Plan", "Hunt", "Queue"], selection: $activitySection)
                    BorderedScroll {
                        VStack(alignment: .leading, spacing: 16) {
                            if activitySection == "Plan" {
                                HuntPlanView(plan: preview)
                            } else if activitySection == "Hunt" { HuntDetailView() }
                            else if requests.isEmpty { ContentUnavailableView(queueError == nil ? "No queued hunts" : "Hunts unavailable", systemImage: "list.bullet", description: queueError.map { Text($0) }) }
                            else {
                                ForEach(requests, id: \.gameID) { row in
                                    queueRow(row)
                                }
                            }
                        }
                    }
                }
            }
            .sheet(isPresented: $choosingSpecies) { SpeciesChooser(selection: $model.selectedSpecies) }
            .sheet(isPresented: $choosingMoves) { HuntMoveChooser(selection: $draft.moveIDs) }
            .task(id: model.selectedGame) {
                while !Task.isCancelled { await reload(); do { try await Task.sleep(for: .seconds(5)) } catch { return } }
            }
            .task(id: draftKey) { await loadDraft() }
            .onChange(of: draft) { _, _ in persistDraft() }
        }
    }
    private func previewHunt() {
        let value = request
        model.perform { preview = (try await model.api?.post("/api/pokemon-farming/preview", value) ?? .null)["plan"]; activitySection = "Plan" }
    }
    private func loadDraft() async {
        let game = model.selectedGame, species = model.selectedSpecies, key = draftKey
        if draftReady, loadedKey == key { return }
        draftReady = false; preview = .null; reviewID = nil
        do {
            guard let api = model.api else { return }
            let defaults = try await api.get("/api/pokemon-suite/bot-settings?game=\(game)")["preferences"]
            guard !Task.isCancelled, key == draftKey else { return }
            let restored = try model.huntDraftStore().load(game: game, speciesID: species, defaults: defaults)
            loadedKey = key; loadedDraft = restored; draft = restored; draftReady = true
        } catch { if !Task.isCancelled, key == draftKey { model.error = error.localizedDescription } }
    }
    private func persistDraft() {
        guard draftReady, loadedKey == draftKey, draft != loadedDraft else { return }
        do {
            try model.huntDraftStore().save(draft, game: model.selectedGame, speciesID: model.selectedSpecies, generation: generation)
            loadedDraft = draft; preview = .null; reviewID = nil
        } catch { model.error = "The hunt draft could not be saved. " + error.localizedDescription }
    }
    private func review(_ row: JSONValue) {
        let restored = HuntDraft(request: row["request"]), species = row["request"]["speciesId"].int
        do {
            try model.huntDraftStore().save(restored, game: model.selectedGame, speciesID: species, generation: generation)
            if model.selectedSpecies != species { model.selectedSpecies = species }
            loadedKey = model.selectedGame + ":" + String(species)
            loadedDraft = restored; draft = restored; draftReady = true
            activitySection = "Plan"; preview = row["plan"]; reviewID = row["id"].string
        } catch { model.error = error.localizedDescription }
    }
    func reload() async {
        let game = model.selectedGame
        do {
            guard let api = model.api else { return }
            let result = try await api.get("/api/pokemon-farming/requests")
            guard !Task.isCancelled, game == model.selectedGame else { return }
            requests = result["requests"].array.filter { $0["request"]["game"].string == game }; queueError = nil
            if let row = requests.first(where: { $0["id"].string == reviewID }) { preview = row["plan"] }
        } catch { if !Task.isCancelled, game == model.selectedGame { queueError = error.localizedDescription } }
    }
    func queue(start: Bool) {
        let value = request, key = draftKey, existing = reviewID
        model.perform {
            guard let api = model.api else { throw SuiteError("Connect to the Suite before starting a hunt.") }
            if let existing {
                if start { model.notice = HuntWorkflow.startMessage(try await api.post("/api/pokemon-farming/start", .object(["id": .string(existing)]))) }
                else { model.notice = "This hunt is already in the queue." }
            } else {
                let plan = try await api.post("/api/pokemon-farming/preview", value)["plan"]
                if key == draftKey { preview = plan; activitySection = "Plan" }
                guard !start || HuntWorkflow.canStart(plan: plan) else { model.notice = plan["limitations"].array.first?.string.nonempty ?? "Review the acquisition requirements before starting."; return }
                let result = try await api.post("/api/pokemon-farming/requests", .object(["request": value, "idempotencyKey": .string(UUID().uuidString)]))
                if key == draftKey { reviewID = result["request"]["id"].string }
                if start { model.notice = HuntWorkflow.startMessage(try await api.post("/api/pokemon-farming/start", .object(["id": result["request"]["id"]]))) }
                else { model.notice = "Hunt queued."; activitySection = "Queue" }
            }
            await reload()
        }
    }
    private func queueRow(_ row: JSONValue) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ROMSprite(id: row["request"]["speciesId"].int, shiny: row["request"]["shiny"].string == "required", size: 40)
                VStack(alignment: .leading, spacing: 3) {
                    Text(row["name"].string.nonempty ?? row["plan"]["pokemon"]["name"].string.nonempty ?? "Pokémon \(row["request"]["speciesId"].text)").font(.headline)
                    Text(readableGameText(row["state"].string)).font(.callout).foregroundStyle(.secondary)
                }
            }
            if let reason = row["execution"]["reason"].string.nonempty { Text(reason).font(.callout).foregroundStyle(.secondary) }
            if !row["execution"]["caught"].isNull { LabeledContent("Caught", value: "\(row["execution"]["caught"].text) / \(row["request"]["quantity"].text)").font(.caption) }
            HStack {
                Button("Review") { review(row) }.disabled(model.busy)
                if HuntWorkflow.activeStates.contains(row["state"].string) { queueButton("Stop", action: "stop", row: row) }
                else if row["state"].string != "complete" { queueButton(HuntWorkflow.startLabel(plan: row["plan"], record: row), action: "start", row: row) }
                Spacer(minLength: 0)
                queueButton("Remove", action: "remove", row: row)
            }.controlSize(.small)
            Divider()
        }
    }
    func queueButton(_ title: String, action: String, row: JSONValue) -> some View {
        let active = HuntWorkflow.activeStates.contains(row["state"].string)
        return Button(title, role: action == "remove" ? .destructive : nil) {
            model.perform {
                guard let api = model.api else { throw SuiteError("Connect to the Suite to manage hunts.") }
                let result = try await api.post("/api/pokemon-farming/\(action)", .object(["id": row["id"]]))
                if action == "start" { model.notice = HuntWorkflow.startMessage(result) }
                await reload()
            }
        }.disabled(model.busy || (action == "remove" && active) || (action == "start" && !HuntWorkflow.canStart(plan: row["plan"], record: row)))
        .help(action == "remove" && active ? "Stop this hunt before removing it" : "\(title) this hunt")
    }
}

private struct HuntMoveChooser: View {
    @EnvironmentObject var model: SuiteModel
    @Environment(\.dismiss) private var dismiss
    @Binding var selection: Set<Int>
    @State private var search = ""
    private var moves: [JSONValue] {
        let ids = Set(model.chosenPokemon["learnset"].array.map { $0["moveId"].int })
        return model.dex["moves"].array.filter { ids.contains($0["id"].int) && (search.isEmpty || $0.label.localizedCaseInsensitiveContains(search)) }
    }
    var body: some View {
        VStack(spacing: 12) {
            HStack { Text("Moves").font(.title2.weight(.semibold)); Spacer(); Text("\(selection.count) of 4").foregroundStyle(.secondary) }
            TextField("Search moves", text: $search).textFieldStyle(.roundedBorder)
            List(moves, id: \.gameID) { move in
                Toggle(move.label, isOn: Binding(get: { selection.contains(move["id"].int) }, set: { if $0 { selection.insert(move["id"].int) } else { selection.remove(move["id"].int) } }))
                    .toggleStyle(.checkbox).disabled(selection.count >= 4 && !selection.contains(move["id"].int))
            }.overlay(Rectangle().stroke(.separator, lineWidth: 1))
            HStack { Button("Clear") { selection = [] }.disabled(selection.isEmpty); Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.defaultAction) }
        }.padding(20).suiteSheetSize(width: 440, height: 470)
    }
}
