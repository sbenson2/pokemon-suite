import SwiftUI
import SuiteCore

/// The legit competitive builder for one species and, optionally, one owned
/// individual: explained set guidance, fixed and changeable traits, a read-only
/// legality verdict and the in-game step plan. Shared by the Mac app and the
/// companion; present it with `.competitiveBuilder($request)` or embed it.
/// It never edits a save: steps start through the existing player-task and
/// request endpoints, and everything else is marked as done in the game.
struct CompetitiveBuilderView: View {
    @EnvironmentObject var model: SuiteModel
    let request: CompetitiveBuilderRequest
    @State private var guidance: JSONValue = .null
    @State private var individual: JSONValue = .null
    @State private var plan: JSONValue = .null
    @State private var requestDraft: JSONValue = .null
    @State private var huntPreview: JSONValue = .null
    @State private var plannedTarget: BuilderTarget?
    @State private var target: BuilderTarget
    @State private var setIndex = 0
    @State private var section = "Set"
    @State private var loading = true
    @State private var failure: String?
    private let game = "firered"
    private let preloaded: Preloaded?

    /// Host responses supplied up front (previews and layout tests); nil reads the host.
    struct Preloaded {
        var guidance: JSONValue
        var individual: JSONValue = .null
        var plan: JSONValue = .null
        var section = "Set"
    }

    init(request: CompetitiveBuilderRequest, preloaded: Preloaded? = nil) {
        self.request = request
        self.preloaded = preloaded
        _target = State(initialValue: BuilderTarget(speciesID: request.speciesID))
    }

    /// The Bank's entry point: a species to build and, optionally, an owned inventory record.
    init(speciesID: Int, pokemon: JSONValue? = nil, sourceID: String = "current") {
        self.init(request: CompetitiveBuilderRequest(speciesID: speciesID, pokemonID: pokemon?["id"].string, sourceID: sourceID))
    }

    private var sections: [String] { request.pokemonID == nil ? ["Set", "Plan"] : ["Set", "Traits", "Legality", "Plan"] }
    private var sets: [JSONValue] { guidance["sets"].array }
    private var currentSet: JSONValue { sets.indices.contains(setIndex) ? sets[setIndex] : .null }
    /// A plan or request draft is shown only for the target it was made for.
    private var fresh: Bool { plannedTarget == target }
    private var currentPlan: JSONValue { fresh ? plan : .null }
    private var newIndividual: JSONValue { guard fresh else { return .null }; return request.pokemonID == nil ? requestDraft["newIndividual"] : plan["newIndividual"] }

    var body: some View {
        VStack(spacing: 0) {
            header.padding(.horizontal, 16).padding(.vertical, 10)
            SectionTabs(label: "Builder", items: sections, selection: $section)
            if loading {
                ProgressView("Reading the Pokémon…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let failure {
                ContentUnavailableView("Builder unavailable", systemImage: "exclamationmark.triangle", description: Text(failure))
            } else {
                Form {
                    Group {
                        switch section {
                        case "Traits": traitsTab
                        case "Legality": legalityTab
                        case "Plan": planTab
                        default: setTab
                        }
                    }
                    #if os(iOS)
                    .listRowBackground(GameFormRowBackground())
                    #endif
                }
                #if os(macOS)
                .gameForm().padding(.horizontal, 12)
                #else
                .formStyle(.grouped).overlay(Rectangle().stroke(.separator, lineWidth: 1).allowsHitTesting(false))
                #endif
            }
            // The target set is edited on Set and compared on Plan; the reading tabs have no action.
            if section == "Set" || section == "Plan" { actionBar }
        }
        .task(id: request) { await load() }
    }

    // MARK: Header and actions

    private var header: some View {
        HStack(spacing: 14) {
            ROMSprite(id: request.speciesID, shiny: individual["pokemon"]["shiny"].bool, size: 56)
            VStack(alignment: .leading, spacing: 4) {
                Text(guidance["name"].string.isEmpty ? "Pokémon \(request.speciesID)" : guidance["name"].string).font(.title2.weight(.semibold))
                Text(headerDetail).font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            if !individual["legality"].isNull { verdictLabel(individual["legality"]) }
        }
    }

    private var headerDetail: String {
        var parts = guidance["types"].array.map { $0.string.capitalized }
        if !individual.isNull {
            let owned = individual["pokemon"]
            parts.append("Yours: \(owned["name"].string), Lv. \(owned["level"].int)")
            let location = owned["location"]
            parts.append(location["kind"].string == "party" ? "Party" : "Box \(location["box"].int + 1)")
        }
        return parts.joined(separator: " · ")
    }

    private var actionBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let issue = target.validation { Label(issue, systemImage: "exclamationmark.circle").font(.callout) }
            HStack {
                Text("\(target.evTotal) / 510 EVs").font(.callout.monospacedDigit()).foregroundStyle(.secondary)
                Spacer()
                Button(request.pokemonID == nil ? "Plan New Individual" : "Compare with This Pokémon") { compare() }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.busy || loading || failure != nil || target.validation != nil)
            }
        }.padding(12).background(.bar)
    }

    private func verdictLabel(_ result: JSONValue) -> some View {
        Label(result["label"].string, systemImage: BuilderPresentation.verdictSymbol(result["verdict"].string))
            .font(.headline)
            .accessibilityLabel("Legality: \(result["label"].string)")
    }

    // MARK: Set

    @ViewBuilder private var setTab: some View {
        Section("Guidance") {
            if sets.count > 1 {
                Picker("Set", selection: $setIndex) {
                    ForEach(Array(sets.enumerated()), id: \.offset) { index, entry in Text(entry["name"].string).tag(index) }
                }.onChange(of: setIndex) { _, index in applySet(index) }
            }
            Text(currentSet["summary"].string)
            ForEach(Array(currentSet["why"].array.dropFirst().enumerated()), id: \.offset) { _, line in
                Text(line.string).font(.callout).foregroundStyle(.secondary)
            }
            Text(guidance["method"].string).font(.caption).foregroundStyle(.secondary)
        }
        Section("Nature and ability") {
            Picker("Nature", selection: Binding(get: { target.nature ?? "" }, set: { target.nature = $0.isEmpty ? nil : $0 })) {
                Text("Any").tag("")
                ForEach(guidance["natures"].array, id: \.gameID) { nature in Text(natureLabel(nature)).tag(nature["id"].string) }
            }
            if !currentSet["nature"]["why"].string.isEmpty { Text(currentSet["nature"]["why"].string).font(.caption).foregroundStyle(.secondary) }
            if guidance["abilities"].array.count > 1 {
                Picker("Ability", selection: Binding(get: { target.abilitySlot ?? -1 }, set: { target.abilitySlot = $0 < 0 ? nil : $0 })) {
                    Text("Any").tag(-1)
                    ForEach(Array(guidance["abilities"].array.enumerated()), id: \.offset) { index, ability in Text(ability["name"].string).tag(index) }
                }
            }
            Text(guidance["ability"]["why"].string).font(.caption).foregroundStyle(.secondary)
        }
        Section("EVs") {
            ForEach(BuilderTarget.stats, id: \.self) { stat in
                Stepper("\(BuilderPresentation.statLabel(stat)): \(target.evs[stat] ?? 0)",
                        value: Binding(get: { target.evs[stat] ?? 0 }, set: { target.evs[stat] = $0 }), in: 0...252, step: 4)
            }
            Text(currentSet["evsWhy"].string).font(.caption).foregroundStyle(.secondary)
        }
        Section("Moves") {
            ForEach(0..<4, id: \.self) { slot in
                Picker("Move \(slot + 1)", selection: moveBinding(slot)) {
                    Text("None").tag(0)
                    ForEach(guidance["movepool"].array, id: \.gameID) { move in Text(moveLabel(move)).tag(move["id"].int) }
                }
                if let note = moveNote(slot) { Text(note).font(.caption).foregroundStyle(.secondary) }
            }
            if target.moves.contains(237) {
                Picker("Hidden Power type", selection: Binding(get: { target.hiddenPowerType ?? "" }, set: { target.hiddenPowerType = $0.isEmpty ? nil : $0 })) {
                    Text("Any").tag("")
                    ForEach(guidance["hiddenPowerTypes"].array.map(\.string), id: \.self) { Text($0.capitalized).tag($0) }
                }
                Text("Hidden Power’s type and power come from the IVs, so a different type means a different individual.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        Section("Held item and level") {
            Picker("Held item", selection: Binding(get: { target.heldItem ?? 0 }, set: { target.heldItem = $0 == 0 ? nil : $0 })) {
                Text("None").tag(0)
                ForEach(guidance["heldItems"].array, id: \.nativeItemID) { item in
                    Text(item["name"].string + (item["obtainableInFireRed"].bool ? "" : " (trade only)")).tag(item["nativeId"].int)
                }
            }
            if !currentSet["item"]["why"].string.isEmpty { Text(currentSet["item"]["why"].string).font(.caption).foregroundStyle(.secondary) }
            Stepper("Level: \(target.level)", value: $target.level, in: 1...100)
            Toggle("Shiny required", isOn: $target.shinyRequired)
        }
        Section("Minimum IVs") {
            ForEach(BuilderTarget.stats, id: \.self) { stat in
                Stepper("\(BuilderPresentation.statLabel(stat)): \(target.minIvs[stat] ?? 0)",
                        value: Binding(get: { target.minIvs[stat] ?? 0 }, set: { target.minIvs[stat] = $0 == 0 ? nil : $0 }), in: 0...31)
            }
            Text("IVs are fixed for each individual. A higher minimum means the bot looks for a new one.").font(.caption).foregroundStyle(.secondary)
        }
        Section("Type matchups") {
            LabeledContent("Weak to", value: matchupText("weak"))
            LabeledContent("Resists", value: matchupText("resist"))
            LabeledContent("Immune to", value: matchupText("immune"))
        }
    }

    private func moveBinding(_ slot: Int) -> Binding<Int> {
        Binding(get: { target.moves.indices.contains(slot) ? target.moves[slot] : 0 }, set: { value in
            var moves = target.moves
            while moves.count <= slot { moves.append(0) }
            moves[slot] = value
            target.moves = moves.filter { $0 > 0 }.reduce(into: [Int]()) { if !$0.contains($1) { $0.append($1) } }
        })
    }

    private func moveNote(_ slot: Int) -> String? {
        guard target.moves.indices.contains(slot) else { return nil }
        let id = target.moves[slot]
        let suggested = currentSet["moves"].array.first { $0["id"].int == id }
        let entry = guidance["movepool"].array.first { $0["id"].int == id } ?? .null
        let parts = [suggested?["why"].string ?? "", entry["source"].string].filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func moveLabel(_ move: JSONValue) -> String {
        let power = move["power"].int > 1 ? " \(move["power"].int)" : ""
        return "\(move["name"].string) · \(move["type"].string.capitalized)\(power)" + (move["needsNewIndividual"].bool ? " · new individual" : "")
    }

    private func natureLabel(_ nature: JSONValue) -> String {
        guard !nature["raised"].isNull else { return nature["name"].string + " (neutral)" }
        return nature["name"].string + " (+\(BuilderPresentation.statLabel(nature["raised"].string)), −\(BuilderPresentation.statLabel(nature["lowered"].string)))"
    }

    private func matchupText(_ key: String) -> String {
        let entries = guidance["matchups"][key].array
        return entries.isEmpty ? "—" : entries.map { entry in
            let value = entry["multiplier"].double
            return entry["type"].string.capitalized + (value == 4 || value == 0.25 ? " ×\(value == 4 ? "4" : "¼")" : "")
        }.joined(separator: ", ")
    }

    // MARK: Traits

    @ViewBuilder private var traitsTab: some View {
        Section("Fixed for this individual") {
            ForEach(individual["fixed"].array, id: \.traitID) { trait in traitRow(trait) }
        }
        Section("Changeable in the game") {
            ForEach(individual["changeable"].array, id: \.traitID) { trait in traitRow(trait) }
        }
    }

    private func traitRow(_ trait: JSONValue) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            LabeledContent(trait["label"].string, value: BuilderPresentation.traitValue(trait["value"]))
            if !trait["note"].string.isEmpty { Text(trait["note"].string).font(.caption).foregroundStyle(.secondary) }
        }
    }

    // MARK: Legality

    @ViewBuilder private var legalityTab: some View {
        let result = individual["legality"]
        Section {
            verdictLabel(result)
            Text(result["summary"].string)
            Text("Read-only: the checker reads the save’s records and never changes them.").font(.caption).foregroundStyle(.secondary)
        }
        Section("Checks") {
            ForEach(Array(result["checks"].array.enumerated()), id: \.offset) { _, check in
                VStack(alignment: .leading, spacing: 2) {
                    Label(check["message"].string, systemImage: BuilderPresentation.severitySymbol(check["severity"].string))
                    Text("\(check["category"].string) · \(BuilderPresentation.severityLabel(check["severity"].string))")
                        .font(.caption).foregroundStyle(.secondary)
                }.accessibilityElement(children: .combine)
            }
        }
        if !result["limits"].array.isEmpty {
            Section("What it cannot check") {
                ForEach(Array(result["limits"].array.enumerated()), id: \.offset) { _, line in Text(line.string).font(.callout) }
                if let url = URL(string: result["citations"]["categories"].string) {
                    Link("Check categories follow PKHeX’s legality analysis", destination: url).font(.callout)
                }
            }
        }
    }

    // MARK: Plan

    @ViewBuilder private var planTab: some View {
        if request.pokemonID != nil && currentPlan.isNull {
            Section { Text("Choose a target set, then compare it with this Pokémon.").foregroundStyle(.secondary) }
        } else if request.pokemonID == nil && (requestDraft.isNull || !fresh) {
            Section { Text("Choose a target set, then plan a new individual with those traits.").foregroundStyle(.secondary) }
        }
        if !currentPlan.isNull {
            Section {
                Text(currentPlan["summary"].string)
                if !currentPlan["fixed"].array.isEmpty {
                    ForEach(currentPlan["fixed"].array, id: \.traitID) { row in
                        Label("\(row["label"].string): \(row["current"].text) → \(row["target"].text)",
                              systemImage: row["matches"].bool ? "checkmark.circle" : "xmark.circle")
                    }
                }
            }
            // When fixed traits cannot match, the new individual comes first; the
            // steps still show what this Pokémon itself could change.
            if !newIndividual.isNull { newIndividualSection }
            if !currentPlan["steps"].array.isEmpty {
                Section(newIndividual.isNull ? "Steps" : "Steps for this Pokémon") {
                    ForEach(currentPlan["steps"].array, id: \.traitID) { step in stepRow(step) }
                }
            }
        } else if !newIndividual.isNull {
            newIndividualSection
        }
    }

    private func stepRow(_ step: JSONValue) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(step["title"].string + (step["optional"].bool ? " (optional)" : "")).font(.headline)
                Spacer()
                if let task = BuilderAPI.playerTask(step: step) {
                    Button("Start") { model.botAction("start", task: task) }
                        .disabled(model.busy || model.selectedGame != game)
                        .help(model.selectedGame == game ? "Starts this bot task in FireRed" : "Select FireRed to start this task")
                        .accessibilityLabel("Start: \(step["title"].string)")
                }
            }
            Text(step["detail"].string).font(.callout)
            if !step["executable"].bool {
                Label(step["manual"].string, systemImage: "hand.point.up.left").font(.caption).foregroundStyle(.secondary)
            } else {
                Label("The bot can run this step.", systemImage: "gearshape").font(.caption).foregroundStyle(.secondary)
            }
        }.padding(.vertical, 2)
    }

    @ViewBuilder private var newIndividualSection: some View {
        // Sibling rows in one section need distinct identities, so each list is keyed by its own prefix.
        Section("New individual") {
            ForEach(lines("reason", newIndividual["reasons"]), id: \.id) { line in
                Label(line.text, systemImage: "xmark.circle").font(.callout)
            }
            ForEach(lines("note", newIndividual["notes"]), id: \.id) { line in
                Text(line.text).font(.caption).foregroundStyle(.secondary)
            }
            if !huntPreview.isNull {
                ForEach(lines("step", huntPreview["steps"]), id: \.id) { line in Text("\(line.index + 1). \(line.text)").font(.callout) }
                ForEach(lines("limit", huntPreview["limitations"]), id: \.id) { line in
                    Text(line.text).font(.caption).foregroundStyle(.secondary)
                }
            }
            HStack {
                Button("Preview Hunt") { previewNewIndividual() }.disabled(model.busy)
                Spacer()
                Button("Request New Individual") { commitNewIndividual() }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.busy || huntPreview.isNull)
            }
            Text("The request joins the bot’s queue like a typed or spoken one; you can cancel it there.").font(.caption).foregroundStyle(.secondary)
        }
    }

    private struct Line: Identifiable { let id: String; let index: Int; let text: String }

    private func lines(_ prefix: String, _ value: JSONValue) -> [Line] {
        value.array.enumerated().map { Line(id: "\(prefix)-\($0.offset)", index: $0.offset, text: $0.element.text) }
    }

    // MARK: Loading and actions

    private func load() async {
        if let preloaded {
            guidance = preloaded.guidance; individual = preloaded.individual; setIndex = 0
            applySet(0)
            plan = preloaded.plan; plannedTarget = preloaded.plan.isNull ? nil : target; section = preloaded.section; loading = false
            return
        }
        loading = true; failure = nil; plan = .null; requestDraft = .null; huntPreview = .null; individual = .null
        do {
            guard let api = model.api else { throw SuiteError("Connect to Pokémon Suite first.") }
            let result = try await api.get(BuilderAPI.guidancePath(speciesID: request.speciesID))["guidance"]
            var owned: JSONValue = .null
            if let id = request.pokemonID {
                owned = try await api.get(BuilderAPI.individualPath(game: game, source: request.sourceID, pokemonID: id))
            }
            guard !Task.isCancelled else { return }
            guidance = result; individual = owned; setIndex = 0
            applySet(0)
            if !sections.contains(section) { section = "Set" }
        } catch {
            guard !Task.isCancelled else { return }
            failure = error.localizedDescription
        }
        loading = false
    }

    private func applySet(_ index: Int) {
        guard sets.indices.contains(index) else { return }
        target = BuilderTarget(target: sets[index]["target"], speciesID: request.speciesID)
    }

    private func compare() {
        let body = request.pokemonID == nil ? BuilderAPI.requestBody(target: target) : BuilderAPI.planBody(game: game, request: request, target: target)
        let path = request.pokemonID == nil ? BuilderAPI.requestPath : BuilderAPI.planPath
        let isPlan = request.pokemonID != nil, planned = target
        model.perform {
            let result = try await model.api?.post(path, body) ?? .null
            if isPlan { plan = result["plan"] } else { requestDraft = result }
            plannedTarget = planned; huntPreview = .null
            section = "Plan"
        }
    }

    private func previewNewIndividual() {
        let body = newIndividual["preview"]["body"]
        model.perform { huntPreview = (try await model.api?.post(BuilderAPI.farmingPreviewPath, body) ?? .null)["plan"] }
    }

    private func commitNewIndividual() {
        let body = BuilderAPI.commitBody(goal: newIndividual["goal"])
        model.perform {
            try await model.api?.post(BuilderAPI.commitPath, body)
            model.notice = "Requested a new \(guidance["name"].string). Follow it under the bot’s requests."
            model.requestsChanged()
        }
    }
}

/// Presents the builder as a sheet: a sized sheet with Done on the Mac, a full
/// navigation sheet on iPhone and iPad.
struct CompetitiveBuilderPresenter: ViewModifier {
    @EnvironmentObject var model: SuiteModel
    @Binding var request: CompetitiveBuilderRequest?

    func body(content: Content) -> some View {
        content.sheet(item: $request) { value in
            #if os(iOS)
            NavigationStack {
                CompetitiveBuilderView(request: value)
                    .navigationTitle("Competitive Builder").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { request = nil } } }
            }
            .environmentObject(model)
            #else
            VStack(spacing: 0) {
                CompetitiveBuilderView(request: value)
                HStack { Spacer(); Button("Done") { request = nil }.keyboardShortcut(.defaultAction) }.padding(12)
            }
            .suiteSheetSize(width: 760, height: 720)
            .environmentObject(model)
            #endif
        }
    }
}

extension View {
    /// Opens the competitive builder while `request` is set (the Bank's hook).
    func competitiveBuilder(_ request: Binding<CompetitiveBuilderRequest?>) -> some View {
        modifier(CompetitiveBuilderPresenter(request: request))
    }
}

private extension JSONValue {
    var traitID: String { self["id"].text }
    var nativeItemID: Int { self["nativeId"].int }
}
