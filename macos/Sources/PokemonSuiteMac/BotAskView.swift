import SwiftUI
import SuiteCore

/// "Ask the bot" in the Bot view header (Mac and companion) and the
/// companion's Live panel. Typed or dictated text goes to the host's request
/// interpreter; the owner answers its questions and runs or confirms the goal.
/// This view never sends game input: it only calls the request and goal endpoints.
struct BotAskView: View {
    @EnvironmentObject var model: SuiteModel
    var body: some View {
        BotAskPanel(flow: model.requests, sessionGoals: SuiteGoals(summary: model.session["goals"]), onChange: model.requestsChanged,
                    vocabulary: DictationVocabulary.phrases(session: model.session, species: model.species))
    }
}

struct BotAskPanel: View {
    @ObservedObject var flow: BotRequestFlow
    /// `session.goals` while the game runs; otherwise the flow's goal list.
    var sessionGoals: SuiteGoals?
    var onChange: @MainActor () -> Void = {}
    /// Dictation hints from the live session: party, hunt target, commands, places.
    var vocabulary: [String] = []
    @StateObject private var dictation = SpeechDictation()
    @State private var text = ""
    @State private var dictated: String?

    private var goals: SuiteGoals? { sessionGoals ?? flow.goals }
    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                TextField("Ask the bot", text: $text, prompt: Text("Ask the bot, e.g. “get me a shiny Mewtwo”"))
                    .textFieldStyle(.roundedBorder).submitLabel(.send).onSubmit(send)
                    .disabled(dictation.listening)
                    .accessibilityIdentifier("bot-ask-text")
                Button(action: toggleDictation) {
                    Image(systemName: dictation.listening ? "stop.circle.fill" : "mic")
                        .foregroundStyle(dictation.listening ? Color.red : Color.accentColor)
                        .frame(minWidth: 22)
                }
                .help(dictation.listening ? "Stop and send the request" : "Dictate a request (recognized on this device)")
                .accessibilityLabel(dictation.listening ? "Stop dictation and send" : "Dictate a request")
                .accessibilityIdentifier("bot-ask-mic")
                .disabled(dictation.preparing || flow.isWorking)
                Button("Send", action: send)
                    .disabled(trimmed.isEmpty || flow.isWorking || dictation.listening)
                    .accessibilityIdentifier("bot-ask-send")
            }
            if dictation.listening {
                Label("Listening… Tap Stop when you’re done.", systemImage: "waveform").font(.caption).foregroundStyle(.secondary)
            } else if let message = dictation.message {
                Label(message, systemImage: "mic.slash").font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("bot-ask-voice-message")
            }
            BotRequestReview(flow: flow, onChange: onChange) { suggestion in
                text = suggestion.id; dictated = nil
                Task { await flow.useSuggestion(suggestion.id) }
            }
            if let goals { BotGoalStatus(flow: flow, goals: goals, onChange: onChange) }
        }
        // Opening Ask starts Laya loading. Without a running game the session carries no goal status; read the goal list once.
        .task { flow.warm(); if sessionGoals == nil { await flow.refreshGoals() } }
        .onDisappear { dictation.cancel() }
    }

    private func send() {
        let value = trimmed
        guard !value.isEmpty, !flow.isWorking, !dictation.listening else { return }
        let via = BotRequestVia.resolve(text: value, dictated: dictated)
        Task { await flow.submit(value, via: via) }
    }

    private func toggleDictation() {
        if !dictation.listening { flow.warm() } // Laya loads while the owner speaks
        dictation.toggle(hints: vocabulary, partial: { partial in
            text = partial; dictated = partial
        }, final: { final in
            text = final; dictated = final
            Task { await flow.submit(final, via: .voice) }
        })
    }
}

/// Ask's review of a request draft: the result line, its question and choices, notes (confirmation
/// reasons, hunt limitations, warnings) and Run/Confirm or Cancel. The Bank's "Get it" shows the same review.
struct BotRequestReview: View {
    @ObservedObject var flow: BotRequestFlow
    var onChange: @MainActor () -> Void = {}
    /// Suggested phrases after a request Ask couldn't read (typed requests only).
    var suggest: ((BotRequestChoice) -> Void)?
    @State private var reply = ""

    /// Its rows join the enclosing stack, as they did inside the Ask panel.
    var body: some View { Group { response } }

    @ViewBuilder private var response: some View {
        let line = flow.resultLine
        if !line.isEmpty {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if flow.isWorking { ProgressView().controlSize(.small) }
                else if case .failed = flow.stage { Image(systemName: "exclamationmark.circle").foregroundStyle(.orange) }
                Text(line).font(.callout).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
            }.accessibilityElement(children: .combine).accessibilityIdentifier("bot-ask-result")
        }
        switch flow.stage {
        case .clarifying(let draft):
            if let question = draft.clarification {
                BotAskChips(items: question.choices, disabled: flow.isWorking) { choice in Task { await flow.choose(choice) } }
                if question.freeText {
                    HStack(spacing: 6) {
                        TextField("Or type an answer", text: $reply).textFieldStyle(.roundedBorder).onSubmit(answer)
                        Button("Answer", action: answer).disabled(reply.trimmingCharacters(in: .whitespaces).isEmpty || flow.isWorking)
                    }
                }
            }
        case .notUnderstood(let draft):
            if let suggest { BotAskChips(items: draft.suggestions.map { BotRequestChoice(id: $0, label: $0) }, disabled: flow.isWorking, action: suggest) }
        case .answered(let draft):
            notes(draft.notes)
            if let suggest, !draft.suggestions.isEmpty {
                BotAskChips(items: draft.suggestions.map { BotRequestChoice(id: $0, label: $0) }, disabled: flow.isWorking, action: suggest)
            }
        case .ready(let draft):
            notes(draft.notes)
            if let error = flow.error {
                Label(error, systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                Button(flow.confirmLabel ?? "Run") { Task { await flow.commit(); onChange() } }
                    .buttonStyle(.borderedProminent).accessibilityIdentifier("bot-ask-run")
                Button("Cancel") { Task { await flow.cancel() }; reply = "" }
            }
        case .committing(let draft):
            notes(draft.notes)
        default:
            EmptyView()
        }
    }

    @ViewBuilder private func notes(_ lines: [String]) -> some View {
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Label(line, systemImage: "info.circle").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }.accessibilityIdentifier("bot-ask-notes")
        }
    }

    private func answer() {
        let value = reply
        reply = ""
        Task { await flow.answer(value) }
    }
}

/// "Your request": the goal the bot works on (or the last one), its progress and Cancel Request.
struct BotGoalStatus: View {
    @ObservedObject var flow: BotRequestFlow
    let goals: SuiteGoals
    var onChange: @MainActor () -> Void = {}
    @State private var cancelling: SuiteGoal?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let goal = goals.current {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Label("Request: “\(goal.text)”", systemImage: "scope").font(.callout.weight(.medium)).lineLimit(2)
                    Spacer(minLength: 8)
                    if goal.isOpen {
                        Button("Cancel Request") { cancelling = goal }.controlSize(.small)
                            .disabled(flow.cancelling != nil).accessibilityIdentifier("bot-ask-cancel-goal")
                    }
                }
                Text(goal.progressLine).font(.caption).foregroundStyle(.secondary)
                if let detail = goal.question ?? goal.detail { Text(detail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                if goals.queued > 0 { Text(goals.queued == 1 ? "1 more request queued" : "\(goals.queued) more requests queued").font(.caption).foregroundStyle(.secondary) }
            } else if let last = goals.last {
                Text("Last request “\(last.text)”: \(last.statusLabel)\(last.result.map { ". \($0)" } ?? "")")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            if let notice = flow.goalNotice { Text(notice).font(.caption).foregroundStyle(.secondary) }
            if let warning = goals.supervisorWarning { Label(warning, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange) }
        }.accessibilityElement(children: .contain).accessibilityIdentifier("bot-ask-goal")
        .confirmationDialog("Cancel this request?", isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } }),
                            titleVisibility: .visible, presenting: cancelling) { goal in
            Button("Cancel Request", role: .destructive) { Task { await flow.cancelGoal(goal.id); onChange() } }
            Button("Keep It", role: .cancel) {}
        } message: { goal in
            Text("The bot withdraws what “\(goal.text)” started, such as its hunt or priority target. Saves and caught Pokémon are kept, and a new game it started keeps playing.")
        }
    }
}

/// Clarification choices and suggestions, wrapped onto as many lines as needed.
private struct BotAskChips: View {
    let items: [BotRequestChoice]
    var disabled = false
    let action: (BotRequestChoice) -> Void
    var body: some View {
        if !items.isEmpty {
            BotAskFlowLayout(spacing: 6) {
                ForEach(items) { item in
                    Button(item.label) { action(item) }.buttonStyle(.bordered).controlSize(.small).disabled(disabled)
                }
            }.accessibilityElement(children: .contain).accessibilityLabel("Choose an answer").accessibilityIdentifier("bot-ask-choices")
        }
    }
}

private struct BotAskFlowLayout: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        return CGSize(width: rows.map(\.width).max() ?? 0, height: rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1)))
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.items {
                let size = subviews[index].sizeThatFits(.init(width: bounds.width, height: nil))
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: .init(width: min(size.width, bounds.width), height: size.height))
                x += min(size.width, bounds.width) + spacing
            }
            y += row.height + spacing
        }
    }
    private func arrange(width: CGFloat, subviews: Subviews) -> [(items: [Int], width: CGFloat, height: CGFloat)] {
        var rows: [(items: [Int], width: CGFloat, height: CGFloat)] = []
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.init(width: width, height: nil))
            let itemWidth = min(size.width, width)
            if let last = rows.last, last.width + spacing + itemWidth <= width {
                rows[rows.count - 1].items.append(index)
                rows[rows.count - 1].width += spacing + itemWidth
                rows[rows.count - 1].height = max(last.height, size.height)
            } else {
                rows.append(([index], itemWidth, size.height))
            }
        }
        return rows
    }
}
