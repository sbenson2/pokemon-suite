import Foundation

/// Coalesces identical loads, bounds work and memory, and removes requests whose
/// views have disappeared. Cancelling one view leaves other consumers intact.
public actor AsyncResourceCache<Key: Hashable & Sendable, Value: Sendable> {
    private struct Entry { let value: Value; let cost: Int }
    private struct Flight {
        let id: UUID
        let load: @Sendable () async throws -> Value
        var waiters: [UUID: CheckedContinuation<Value, Error>]
        var task: Task<Void, Never>?
    }
    private let costLimit: Int, countLimit: Int, concurrency: Int
    private let cost: @Sendable (Value) -> Int
    private var cached: [Key: Entry] = [:]
    private var order: [Key] = []
    private var totalCost = 0
    private var flights: [Key: Flight] = [:]
    private var queue: [Key] = []
    private var running = 0

    public init(costLimit: Int, countLimit: Int, concurrency: Int, cost: @escaping @Sendable (Value) -> Int) {
        self.costLimit = max(0, costLimit); self.countLimit = max(0, countLimit)
        self.concurrency = max(1, concurrency); self.cost = cost
    }

    public func cachedValue(for key: Key) -> Value? {
        guard let entry = cached[key] else { return nil }
        order.removeAll { $0 == key }; order.append(key)
        return entry.value
    }

    public func removeValue(for key: Key) {
        totalCost -= cached.removeValue(forKey: key)?.cost ?? 0
        order.removeAll { $0 == key }
    }

    public func value(for key: Key, load: @escaping @Sendable () async throws -> Value) async throws -> Value {
        try Task.checkCancellation()
        if let value = cachedValue(for: key) { return value }
        let waiter = UUID()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                if Task.isCancelled { continuation.resume(throwing: CancellationError()); return }
                if flights[key] != nil { flights[key]?.waiters[waiter] = continuation }
                else {
                    flights[key] = Flight(id: UUID(), load: load, waiters: [waiter: continuation])
                    queue.append(key)
                }
                startNext()
            }
        } onCancel: { Task { await self.cancel(key, waiter: waiter) } }
    }

    private func cancel(_ key: Key, waiter: UUID) {
        guard var flight = flights[key], let continuation = flight.waiters.removeValue(forKey: waiter) else { return }
        continuation.resume(throwing: CancellationError())
        if flight.waiters.isEmpty {
            flights.removeValue(forKey: key); queue.removeAll { $0 == key }
            flight.task?.cancel()
        } else { flights[key] = flight }
    }

    private func startNext() {
        while running < concurrency, !queue.isEmpty {
            let key = queue.removeFirst()
            guard let flight = flights[key] else { continue }
            running += 1
            flights[key]?.task = Task.detached(priority: .userInitiated) {
                let result: Result<Value, Error>
                do {
                    try Task.checkCancellation()
                    let value = try await flight.load()
                    try Task.checkCancellation()
                    result = .success(value)
                } catch { result = .failure(error) }
                await self.finish(key, id: flight.id, result: result)
            }
        }
    }

    private func finish(_ key: Key, id: UUID, result: Result<Value, Error>) {
        running -= 1
        defer { startNext() }
        // A cancelled job can finish after a new view requested this key.
        guard let flight = flights[key], flight.id == id else { return }
        flights.removeValue(forKey: key)
        if case .success(let value) = result {
            let bytes = max(0, cost(value))
            if bytes <= costLimit, countLimit > 0 {
                cached[key] = Entry(value: value, cost: bytes); order.append(key); totalCost += bytes
                while totalCost > costLimit || order.count > countLimit {
                    let oldest = order.removeFirst()
                    totalCost -= cached.removeValue(forKey: oldest)?.cost ?? 0
                }
            }
        }
        for continuation in flight.waiters.values { continuation.resume(with: result) }
    }
}
