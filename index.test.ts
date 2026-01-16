import { expect, test, describe } from "bun:test";
import { Chan, selectChan, ChannelError } from "./index";

describe("Chan Basic & Buffering", () => {
    test("Unbuffered channel should block (fast-path check)", () => {
        const ch = new Chan<number>();
        const result = ch.tryRead();
        // Should not be able to read from an empty unbuffered channel
        expect(result.ok).toBe(false);
        expect(result.closed).toBe(false);
    });

    test("Buffered channel storage and sequence", () => {
        const ch = new Chan<number>(2);
        expect(ch.tryWrite(1).ok).toBe(true);
        expect(ch.tryWrite(2).ok).toBe(true);
        expect(ch.tryWrite(3).ok).toBe(false); // Buffer full

        expect(ch.tryRead().value).toBe(1);
        expect(ch.length).toBe(1);
        expect(ch.tryRead().value).toBe(2);
        expect(ch.length).toBe(0);
    });

    test("Channel closure and state", async () => {
        const ch = new Chan<void>();
        expect(ch.isClosed).toBe(false);

        setTimeout(() => ch.close(), 50);
        await ch.wait();

        expect(ch.isClosed).toBe(true);
        const readResult = ch.tryRead();
        expect(readResult.closed).toBe(true);
    });
});

describe("Async Operations & Iterators", () => {
    test("Producer and Consumer synchronization", async () => {
        const ch = new Chan<string>();

        // Async write task
        const writeTask = (async () => {
            return await ch.write("hello");
        })();

        // Async read
        const readResult = await ch.read();
        const writeResult = await writeTask;

        expect(readResult.value).toBe("hello");
        expect(writeResult.ok).toBe(true);
    });

    test("Async Iterator (for await)", async () => {
        const ch = new Chan<number>(5);
        [10, 20, 30].forEach(v => ch.tryWrite(v));
        ch.close();

        const results: number[] = [];
        for await (const val of ch) {
            results.push(val);
        }
        expect(results).toEqual([10, 20, 30]);
    });
});

describe("Select Multi-plexing", () => {
    test("Select random distribution (Fairness)", async () => {
        const ch1 = new Chan<number>(1);
        const ch2 = new Chan<number>(1);
        ch1.tryWrite(1);
        ch2.tryWrite(2);

        const counts = { ch1: 0, ch2: 0 };

        // Execute 100 selects to verify statistical randomness
        for (let i = 0; i < 100; i++) {
            const selected = await selectChan({
                chans: [ch1.readCase(), ch2.readCase()]
            });

            if (selected === ch1.readCase()) {
                counts.ch1++;
                ch1.tryWrite(1); // refill
            } else if (selected === ch2.readCase()) {
                counts.ch2++;
                ch2.tryWrite(2); // refill
            }
        }

        // Both channels should be selected significantly more than 0 times
        expect(counts.ch1).toBeGreaterThan(10);
        expect(counts.ch2).toBeGreaterThan(10);
    });

    test("Select default branch (Non-blocking)", () => {
        const ch = new Chan<number>();
        const selected = selectChan({
            chans: [ch.readCase()],
            default: true
        });
        // Should return null immediately since ch is empty and unbuffered
        expect(selected).toBeNull();
    });
});

describe("Edge Cases & Signal Handling", () => {
    test("Abort read operation with signal", async () => {
        const ch = new Chan<number>();
        const controller = new AbortController();

        const readPromise = ch.read({
            signal: controller.signal,
            silent: true
        });

        // Trigger abort
        controller.abort("test-reason");
        const result = await (readPromise as Promise<any>);

        expect(result.closed).toBeNull();
        expect(result.reason).toBe("test-reason");
    });

    test("Writing to closed channel (exception and silent mode)", () => {
        const ch = new Chan<number>();
        ch.close();

        // Throw exception by default
        expect(() => ch.tryWrite(1)).toThrow(ChannelError);

        // Return error status in silent mode
        const result = ch.tryWrite(1, { silent: true });
        expect(result.ok).toBe(false);
        expect(result.error).toBe(true);
    });

    test("Chan.never and Chan.closed tokens", () => {
        const never = Chan.never;
        const closed = Chan.closed;

        expect(never.tryRead().ok).toBe(false);
        expect(closed.isClosed).toBe(true);
        expect(closed.tryRead().closed).toBe(true);
    });
});

describe("Select WriteCase Operations", () => {
    test("Select WriteCase when buffer is full", async () => {
        const ch = new Chan<number>(1);
        ch.tryWrite(99); // Fill the buffer

        let writeExecuted = false;
        // This select should block because the buffer is full
        const selectPromise = selectChan({
            chans: [ch.writeCase(100)]
        });

        // Simulate a consumer reading after a delay
        setTimeout(() => {
            const result = ch.tryRead();
            expect(result.value).toBe(99);
        }, 50);

        const selected = await (selectPromise as Promise<any>);
        expect(selected).toBeDefined();

        // Retrieve the write result from the case
        const writeResult = selected.write();
        expect(writeResult.ok).toBe(true);

        // Verify the new value is now in the channel
        expect(ch.tryRead().value).toBe(100);
    });

    test("Select multiple WriteCases (Fairness)", async () => {
        const ch1 = new Chan<number>(); // Unbuffered
        const ch2 = new Chan<number>(); // Unbuffered

        const counts = { ch1: 0, ch2: 0 };

        // Consumer 1 for ch1
        const consume = async (c: Chan<number>, key: 'ch1' | 'ch2') => {
            while (!c.isClosed) {
                await c.read();
                counts[key]++;
            }
        };

        const p1 = consume(ch1, 'ch1');
        const p2 = consume(ch2, 'ch2');

        // Execute 100 selects to write to either ch1 or ch2
        for (let i = 0; i < 100; i++) {
            const selected = await selectChan({
                chans: [ch1.writeCase(i), ch2.writeCase(i)]
            });
            // The shuffle in selectChan ensures randomness here
        }

        ch1.close();
        ch2.close();
        await Promise.all([p1, p2]);

        // Both channels should have received values statistically
        expect(counts.ch1).toBeGreaterThan(10);
        expect(counts.ch2).toBeGreaterThan(10);
    });

    test("WriteCase to a closed channel", async () => {
        const ch = new Chan<number>();
        ch.close();

        // Writing to a closed channel should trigger the case immediately with an error
        const selected = await selectChan({
            chans: [ch.writeCase(1)],
            silent: true
        });

        const result = (selected as any).write();
        expect(result.ok).toBe(false);
        expect(result.error).toBe(true);
        expect(result.reason.message).toContain("closed");
    });
});