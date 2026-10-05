import SwiftUI
import SuiteCore

/// The Bank's "Get it" (Mac and companion): the catch settings Ask understands, chosen as
/// fields. Preview sends them to the host, which builds the same goal as the typed phrase;
/// the plan, confirmation, queue, "Your request" progress and Cancel are Ask's own views
/// and request flow. Nothing here starts a hunt or sends game input.
struct BankGetItView: View {
    @EnvironmentObject var model: SuiteModel
    /// The species from the game's Pokédex catalog and its Bank route.
    let mon: JSONValue
    let route: JSONValue
    @ObservedObject var flow: BotRequestFlow
    @State private var draft: BankDraft

    /// `settings`: the fields to start from (by default any Pokémon of the species, kept in the save).
    init(mon: JSONValue, route: JSONValue, flow: BotRequestFlow, settings: BankDraft? = nil) {
        self.mon = mon; self.route = route; self.flow = flow
        _draft = State(initialValue: settings ?? BankDraft(speciesId: mon["id"].int))
    }

    private var natures: [JSONValue] { model.dex["natures"].array }
    private var genders: [String] { BankDraft.genders(rate: mon["genderRate"].int) }
    private var abilities: [JSONValue] { mon["abilities"].array }
    private var goals: SuiteGoals? { SuiteGoals(summary: model.session["goals"]) ?? flow.goals }
    /// A preview of these exact settings (a changed setting needs a new preview before it can run).
    private var previewed: Bool { flow.selection == draft.selection && flow.draft != nil }

    var body: some View {
        Form {
            Group {
                Section {
                    HStack(spacing: 14) {
                        ROMSprite(id: mon["id"].int, shiny: draft.shiny, size: 64)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Get \(mon["name"].string)").font(.title3.weight(.semibold))
                            Text(route["label"].string).font(.callout).foregroundStyle(.secondary)
                        }
                    }
                    Text(route["detail"].string).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                if !route["obtainable"].bool {
                    Section {
                        Label("FireRed can’t obtain \(mon["name"].string) on its own, so the bot can’t get it. \(route["detail"].string)", systemImage: "info.circle")
                            .fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("bank-get-it-unavailable")
                    }
                } else {
                    catchSettings
                    ivSettings
                    Section("After the catch") {
                        Picker("Then", selection: $draft.destination) {
                            Text(draft.quantity == 1 ? "Keep it in the save" : "Keep them in the save").tag("save")
                            Text(draft.quantity == 1 ? "Send it to the Switch" : "Send them to the Switch").tag("switch")
                        }.disabled(!draft.canSendToSwitch).accessibilityIdentifier("bank-destination")
                        if !draft.canSendToSwitch {
                            Text("Sending to the Switch right after the catch works for up to \(BankDraft.maxSwitchQuantity) Pokémon. Catch more first, then send them from Owned.")
                                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        } else if draft.destination == "switch" && draft.quantity > 1 {
                            Text("They are traded one at a time; your Switch joins and confirms each trade.")
                                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    plan
                }
            }
            #if os(iOS)
            .listRowBackground(GameFormRowBackground())
            #endif
        }
        .formStyle(.grouped)
        .onChange(of: draft) { _, value in
            if !value.canSendToSwitch && value.destination == "switch" { draft.keepDestinationValid() }
            // A preview belongs to the settings it was made for; a changed setting drops it.
            if flow.selection != nil, flow.selection != draft.selection, flow.draft != nil, !flow.isWorking { flow.reset() }
        }
        .onAppear { if flow.selection?["speciesId"].int != mon["id"].int, !flow.isWorking { flow.reset() } }
    }

    @ViewBuilder private var catchSettings: some View {
        Section("Catch") {
            Toggle("Shiny", isOn: $draft.shiny).accessibilityIdentifier("bank-shiny")
            Stepper("Quantity: \(draft.quantity)", value: $draft.quantity, in: 1...BankDraft.maxQuantity)
            LabeledContent("Nature") {
                Menu(draft.natures.isEmpty ? "Any" : draft.natures.map(\.capitalized).joined(separator: ", ")) {
                    Button("Any") { draft.natures = [] }
                    ForEach(natures, id: \.gameID) { nature in
                        Toggle(natureLabel(nature), isOn: Binding(get: { draft.natures.contains(nature["id"].string) },
                                                                set: { _ in draft.toggleNature(nature["id"].string, order: natures.map { $0["id"].string }) }))
                    }
                }
                #if os(iOS)
                .menuActionDismissBehavior(.disabled)  // choose several natures in one visit
                #endif
                .fixedSize().accessibilityLabel("Natures").accessibilityIdentifier("bank-natures")
            }
            if genders.count > 1 {
                Picker("Gender", selection: $draft.gender) {
                    Text("Any").tag(String?.none)
                    ForEach(genders, id: \.self) { Text($0.capitalized).tag(String?.some($0)) }
                }
            }
            if abilities.count > 1 {
                Picker("Ability", selection: $draft.abilityId) {
                    Text("Any").tag(Int?.none)
                    ForEach(abilities, id: \.gameID) { Text($0.label).tag(Int?.some($0["id"].int)) }
                }
            }
            Picker("Hidden Power", selection: $draft.hiddenPower) {
                Text("Any").tag(String?.none)
                ForEach(BankDraft.hiddenPowerTypes, id: \.self) { Text($0.capitalized).tag(String?.some($0)) }
            }
        }
    }

    @ViewBuilder private var ivSettings: some View {
        Section {
            ForEach(BankDraft.stats, id: \.self) { stat in
                HStack(spacing: 8) {
                    Text(bankStatName(stat)).frame(maxWidth: .infinity, alignment: .leading)
                    Picker("\(bankStatName(stat)) minimum IV", selection: Binding(get: { draft.minimumIV(stat) }, set: { draft.setMinimumIV(stat, $0) })) {
                        ForEach(0...31, id: \.self) { Text("\($0)").tag($0) }
                    }.labelsHidden().fixedSize()
                    Text("to").foregroundStyle(.secondary)
                    Picker("\(bankStatName(stat)) maximum IV", selection: Binding(get: { draft.maximumIV(stat) }, set: { draft.setMaximumIV(stat, $0) })) {
                        ForEach(0...31, id: \.self) { Text("\($0)").tag($0) }
                    }.labelsHidden().fixedSize()
                }.monospacedDigit()
            }
        } header: { Text("IVs") } footer: { Text("0 to 31 is any value. The bot filters and targets natural encounters; it never edits a Pokémon.") }
    }

    @ViewBuilder private var plan: some View {
        Section("Plan") {
            Button(previewed ? "Preview Again" : "Preview Plan") { Task { await flow.select(draft.selection) } }
                .disabled(flow.isWorking).accessibilityIdentifier("bank-preview")
            if previewed, let draft = flow.draft, let budget = BankDraft.budget(goal: draft.goal) {
                Label(budget, systemImage: "clock").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            BotRequestReview(flow: flow, onChange: model.requestsChanged)
            if let goals { BotGoalStatus(flow: flow, goals: goals, onChange: model.requestsChanged) }
        }
    }

    private func natureLabel(_ nature: JSONValue) -> String {
        let up = nature["increased"].string, down = nature["decreased"].string
        return up.isEmpty ? nature.label : "\(nature.label) (+\(bankStatName(up)), −\(bankStatName(down)))"
    }
}

func bankStatName(_ stat: String) -> String {
    ["hp": "HP", "attack": "Attack", "defense": "Defense", "specialAttack": "Sp. Atk", "specialDefense": "Sp. Def", "speed": "Speed"][stat] ?? stat
}

