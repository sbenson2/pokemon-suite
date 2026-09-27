import SwiftUI
import SuiteCore

struct LiveSessionPanel: View {
    @EnvironmentObject var model: SuiteModel
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var typeSize
    var compact = false
    var contentHeight: CGFloat = 207
    @State private var expanded = false
    @State private var asking = false
    /// FireRed runs the request interpreter and goal supervisor.
    private var canAsk: Bool { model.selectedGame == "firered" && model.game["capabilities"]["bot"].bool }
    var body: some View {
        TimelineView(.periodic(from: .now, by: 2)) { context in
            let p = ActivityPresentation(session: model.session, catalog: model.dex, connected: model.connected, now: context.date)
            let heading = p.needsAttention ? p.why ?? p.now : p.now
            GamePanel(title: "Session", compact: compact) {
                VStack(alignment: .leading, spacing: 6) {
                    Label(p.status, systemImage: p.symbol)
                        .font(compact ? .system(size: 11, weight: .semibold) : .subheadline.weight(.semibold))
                        .foregroundStyle(statusColor(p))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("session-status")
                    Button { expanded.toggle() } label: {
                        HStack(alignment: .top, spacing: 4) {
                            Text(expanded ? "Back to summary" : heading)
                                .font(compact ? .system(size: 12, weight: .semibold) : .headline)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                            Image(systemName: expanded ? "chevron.up" : "chevron.down").font(.caption2)
                        }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityIdentifier("session-detail-toggle")
                        .accessibilityLabel(expanded ? "Back to session summary" : "Session details, \(heading)")
                        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
                    if let progress = p.goalProgress {
                        Text("\(progress.label): \(progress.value)")
                            .font(compact ? .system(size: 11, weight: .medium) : .callout)
                            .monospacedDigit().fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("session-goal-progress")
                    }
                    ScrollView {
                        VStack(alignment: .leading, spacing: compact ? 9 : 12) {
                            // Why it stopped (L1.1); the full card and any fix are under the session details.
                            if let triage = p.triage { detail("Why it stopped · \(triage.bucketLabel)", triage.title) }
                            if let request = p.outline.request { detail("Your request", ([request.title] + request.notes.prefix(1)).joined(separator: " · ")) }
                            if let goal = p.headline { detail(p.stale ? "Last reported goal" : "Goal", goal) }
                            if let location = p.location { detail("Location", location) }
                            if expanded {
                                detail("Now", p.now)
                            }
                            if let why = p.why, expanded || !p.needsAttention { detail(expanded ? "Why" : nil, why) }
                            if expanded || p.needsAttention, let next = p.next { detail("Next", next) }
                            if expanded, let destination = p.destination, destination != p.location { detail("Destination", destination) }
                            ForEach(p.facts.filter { $0 != p.goalProgress && (expanded || ["Hunt time", "Encounters", "Postgame goals", "Without task progress"].contains($0.label) || $0.label.hasPrefix("Deferred:")) }) { fact in
                                detail(fact.label, fact.value)
                            }
                            if expanded {
                                ForEach(p.metrics) { fact in detail(fact.label, fact.value) }
                                ForEach(p.decisions.prefix(5)) { event in
                                    detail("Recent action", event.title + (event.repeats > 1 ? " (\(event.repeats) repeats)" : ""))
                                }
                            } else if !p.facts.contains(where: { $0.label == "Hunt time" }) {
                                metric("Bot time", source: "Active bot time", p: p)
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.trailing, 2)
                    }.id(expanded).scrollIndicators(.visible).scrollBounceBehavior(.basedOnSize)
                        .frame(height: typeSize.isAccessibilitySize ? 220 : nil)
                        .accessibilityIdentifier("session-detail-facts")
                    HStack(alignment: .center, spacing: 6) {
                        Text(p.freshness)
                            .font(.system(size: compact ? 10 : 12)).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("session-freshness")
                        Spacer(minLength: 0)
                        if canAsk {
                            Button { asking = true } label: { Label("Ask", systemImage: "text.bubble").font(.system(size: compact ? 11 : 13, weight: .semibold)) }
                                .buttonStyle(.borderless).frame(minHeight: 32).contentShape(Rectangle())
                                .accessibilityLabel("Ask the bot").accessibilityIdentifier("session-ask")
                        }
                    }
                }.frame(height: compact ? contentHeight : typeSize.isAccessibilitySize ? nil : 360, alignment: .top)
                    .foregroundStyle(Color.primary)
            }
        }.accessibilityElement(children: .contain).accessibilityIdentifier("live-session-stats")
            .onChange(of: model.selectedGame) { _, _ in expanded = false }
            .sheet(isPresented: $asking) { BotAskSheet().environmentObject(model) }
    }
    private func statusColor(_ p: ActivityPresentation) -> Color {
        switch p.attention {
        case .review: return colorScheme == .dark ? .red : Color(red: 0.70, green: 0.11, blue: 0.10)
        case .routeUnavailable: return colorScheme == .dark ? .orange : Color(red: 0.52, green: 0.26, blue: 0.00)
        case .none: return .primary
        }
    }
    private func detail(_ label: String?, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let label { Text(label).foregroundStyle(.secondary).font(.system(size: compact ? 10 : 12)) }
            Text(value).font(compact ? .system(size: 11) : .callout)
                .fixedSize(horizontal: false, vertical: true).monospacedDigit()
        }.accessibilityElement(children: .combine)
    }
    private func metric(_ label: String, source: String, p: ActivityPresentation) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 10)).foregroundStyle(.secondary)
            Text(p.metrics.first { $0.label == source }?.value ?? "—").font(.system(size: 12, weight: .medium))
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.85)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The Live panel's quick "Ask": the shared Ask UI (typed or dictated) in a sheet.
private struct BotAskSheet: View {
    @EnvironmentObject var model: SuiteModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView { BotAskView().padding(16).frame(maxWidth: .infinity, alignment: .leading) }
                .navigationTitle("Ask the bot").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }.presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
    }
}

struct LiveActivityDetails: View {
    @EnvironmentObject var model: SuiteModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 2)) { context in
                let p = ActivityPresentation(session: model.session, catalog: model.dex, connected: model.connected, now: context.date)
                BorderedScroll {
                    // The shared Mac presentation: goal, task, plan, route, up next,
                    // the postgame checklist and decision evidence.
                    VStack(alignment: .leading, spacing: 18) {
                        if model.manual {
                            Label("You control the game. Automated input is paused while you play.", systemImage: "gamecontroller").font(.callout)
                        }
                        ActivityContent(presentation: p, onTriageFix: { model.applyTriageFix($0) })
                    }
                }
            }.navigationTitle("Bot activity").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

private struct LiveTelemetryDetails: View {
    @EnvironmentObject var model: SuiteModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 2)) { context in
                let p = ActivityPresentation(session: model.session, catalog: model.dex, connected: model.connected, now: context.date)
                BorderedScroll {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Session Stats").font(.headline)
                        sessionMetrics(p)
                        Text("Game counters belong to this save. Bot time excludes pauses.").font(.caption).foregroundStyle(.secondary)
                        Divider()
                        Text("Connection").font(.headline)
                        LiveFactRow(label: "Host", value: model.connected ? "Connected" : "Reconnecting")
                        LiveFactRow(label: "Last update", value: p.freshness)
                        ForEach(p.diagnostics.filter { $0.label != "Game mode" }) { fact in
                            LiveFactRow(label: fact.label, value: fact.value)
                        }
                    }.textSelection(.enabled)
                }
            }.navigationTitle("Telemetry").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

@ViewBuilder private func sessionMetrics(_ p: ActivityPresentation) -> some View {
    if p.metrics.isEmpty { Text("Session counters unavailable").foregroundStyle(.secondary) }
    else { ForEach(p.metrics) { fact in LiveFactRow(label: fact.label, value: fact.value) } }
}

private struct LiveFactRow: View {
    let label: String
    let value: String
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 12) { Text(label).foregroundStyle(.secondary); Spacer(minLength: 0); Text(value).monospacedDigit() }
                .fixedSize(horizontal: true, vertical: false)
            VStack(alignment: .leading, spacing: 3) { Text(label).foregroundStyle(.secondary); Text(value).monospacedDigit().fixedSize(horizontal: false, vertical: true) }
        }.font(.callout).frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
    }
}
