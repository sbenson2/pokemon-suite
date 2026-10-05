import SwiftUI
import SuiteCore

/// Other FireRed saves that help the main save get one-per-save Pokémon: trade partners that lend,
/// and helper saves the bot plays only until they can give their Pokémon. Rows and actions come from
/// the host's extra-save plan (ExtraSavePlan); every action asks before it starts.
struct ExtraSavesSection: View {
    @EnvironmentObject var model: SuiteModel
    @State private var plan: ExtraSavePlan?
    @State private var issue: String?
    @State private var pending: ExtraSavePlan.Action?
    var body: some View {
        Section {
            if let plan {
                if plan.rows.isEmpty { Text("Nothing needs another save right now.").foregroundStyle(.secondary) }
                ForEach(plan.rows) { row in ExtraSaveRowView(row: row) { pending = $0 } }
                if !plan.partners.isEmpty {
                    LabeledContent("Trade partners") {
                        Text(plan.partners.map(Self.partnerText).joined(separator: ", ")).foregroundStyle(.secondary)
                    }
                }
            } else if let issue { Label(issue, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary) }
            else { ProgressView().controlSize(.small) }
        } header: {
            Text("Other saves that help this one")
        } footer: {
            Text("Some Pokémon come only from a different save: a starter, a fossil, a Dojo prize or a roaming legendary. The bot borrows or receives them by trade; your other saves are never edited in place.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .task(id: model.selectedGame) { await load() }
        .confirmationDialog(pending?.title ?? "", isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }), titleVisibility: .visible) {
            Button(pending?.title ?? "Start") {
                guard let action = pending else { return }
                pending = nil
                model.perform { [model] in
                    try await model.api?.post(action.path, action.body)
                    model.notice = "\(action.title): started. Its progress appears in this list."
                }
                Task { try? await Task.sleep(for: .seconds(2)); await load() }
            }
        } message: { Text(pending?.effect ?? "") }
    }
    private static func partnerText(_ partner: ExtraSavePlan.Partner) -> String {
        guard let lent = partner.lending else { return partner.owner }
        return "\(partner.owner) (lending \(lent))"
    }
    private func load() async {
        guard model.selectedGame == "firered", let api = model.api else { plan = ExtraSavePlan(.null); return }
        do { plan = ExtraSavePlan(try await api.get("/api/pokemon-suite/extra-saves")); issue = nil }
        catch {
            // The FireRed session carries the same rows while the game runs.
            let rows = model.session["extraSaves"]
            if !rows.array.isEmpty { plan = ExtraSavePlan(rows) } else { issue = error.localizedDescription }
        }
    }
}

private struct ExtraSaveRowView: View {
    let row: ExtraSavePlan.Row
    let start: (ExtraSavePlan.Action) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(row.label).fontWeight(.semibold)
                Spacer(minLength: 8)
                Text(row.statusLabel).font(.caption.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.quaternary, in: Capsule()).accessibilityLabel("Status: \(row.statusLabel)")
            }
            HStack(spacing: 2) { ForEach(row.species, id: \.self) { ROMSprite(id: $0, size: 28) } }.accessibilityHidden(true)
            Text(row.doing.nonempty ?? row.route).font(.callout).fixedSize(horizontal: false, vertical: true)
            HStack {
                Text([row.save, row.mode].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                Spacer(minLength: 8)
                if let action = row.action { Button(action.title + "…") { start(action) }.help(action.effect) }
            }
        }.padding(.vertical, 4).accessibilityElement(children: .contain)
    }
}
