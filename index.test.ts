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


describe("Select Advanced Operations (Default & Mixed Read-Write)", () => {

    test("selectChan: Non-blocking behavior with 'default'", () => {
        const ch = new Chan<number>(); // Unbuffered and no pending readers/writers

        // If no cases are ready, setting default: true should return null immediately
        const selected = selectChan({
            chans: [ch.readCase()],
            default: true
        });

        expect(selected).toBeNull();
    });

    test("selectChan: Mixed ReadCase and WriteCase (Buffer competition)", async () => {
        const ch = new Chan<number>(1); // Capacity = 1

        // Scenario 1: Buffer is empty. WriteCase should be ready, ReadCase should block.
        const sel1 = selectChan({
            chans: [ch.readCase(), ch.writeCase(100)],
            default: true // Use default for synchronous check
        });
        expect(sel1).toBe(ch.writeCase(100));
        expect(ch.length).toBe(1); // Confirm data entered the buffer

        // Scenario 2: Buffer is full. ReadCase should be ready, WriteCase should block.
        const sel2 = selectChan({
            chans: [ch.readCase(), ch.writeCase(200)],
            default: true
        });
        expect(sel2).toBe(ch.readCase());
        expect((sel2 as any).read()?.value).toBe(100);
        expect(ch.length).toBe(0); // Confirm data was read
    });

    test("selectChan: Multi-channel R/W competition (Fairness/Random selection)", async () => {
        const readerChan = new Chan<string>(1);
        const writerChan = new Chan<string>(1);

        // Pre-fill readerChan so a read is ready
        readerChan.tryWrite("data");
        // Keep writerChan empty so a write is ready

        const counts = { read: 0, write: 0 };

        // Execute multiple selects. When both read and write are possible, distribution should be random.
        for (let i = 0; i < 100; i++) {
            const selected = await selectChan({
                chans: [
                    readerChan.readCase(),
                    writerChan.writeCase("payload")
                ]
            });

            if (selected === readerChan.readCase()) {
                counts.read++;
                readerChan.tryWrite("data"); // Refill data for next iteration
            } else {
                counts.write++;
                writerChan.tryRead(); // Clear data for next iteration
            }
        }

        // Verify that both cases were selected significantly (Fairness check)
        expect(counts.read).toBeGreaterThan(10);
        expect(counts.write).toBeGreaterThan(10);
    });

    test("selectChan: AbortSignal priority in mixed mode", async () => {
        const ch = new Chan<number>();
        const controller = new AbortController();
        controller.abort("immediate-stop");

        // Even if cases are potentially executable, if signal is already aborted, 
        // it should return the abortion reason first.
        const result = await selectChan({
            chans: [ch.writeCase(1)],
            signal: controller.signal,
            silent: true
        });

        expect(result).toHaveProperty('reason', "immediate-stop");
    });

    test("selectChan: Handling multiple closed channels simultaneously", async () => {
        const ch1 = new Chan<number>();
        const ch2 = new Chan<number>();
        ch1.close();
        ch2.close();

        const selected = await selectChan({
            chans: [ch1.readCase(), ch2.readCase()]
        });

        // Any closed channel's readCase should be ready immediately
        expect([ch1.readCase(), ch2.readCase()]).toContain(selected as any);
        expect((selected as any).read().closed).toBe(true);
    });
});

describe("Advanced Concurrency & Timeout Tests", () => {

    test("Mixed Read-Write: Async handoff with background consumer", async () => {
        const dataCh = new Chan<number>(2);    // Buffered
        const signalCh = new Chan<string>();   // Unbuffered

        let readCount = 0;
        let writeCount = 0;

        // Start a background consumer for the unbuffered channel
        // This ensures signalCh.writeCase("OK") can eventually succeed
        const consumer = (async () => {
            while (!signalCh.isClosed) {
                await signalCh.read({ silent: true });
                await new Promise(r => setTimeout(r, 1)); // Small delay to force async
            }
        })();

        // Stress test: 50 iterations
        for (let i = 0; i < 50; i++) {
            // Ensure dataCh has something occasionally to make readCase ready
            if (i % 2 === 0) dataCh.tryWrite(i);

            const result = await selectChan({
                chans: [
                    dataCh.readCase(),
                    signalCh.writeCase("OK")
                ]
            });

            if (result === dataCh.readCase()) {
                readCount++;
                // Reset the case value after reading
                (result as any).read();
            } else if (result === signalCh.writeCase("OK")) {
                writeCount++;
            }
        }

        signalCh.close();
        await consumer;

        // Both cases should have been hit at least once
        expect(readCount + writeCount).toBe(50);
        expect(readCount).toBeGreaterThan(0);
        expect(writeCount).toBeGreaterThan(0);
    });

    test("Signal Timeout: Abort a pending select after duration", async () => {
        const ch = new Chan<number>(); // Never written to

        // Use AbortSignal.timeout (available in modern environments like Bun/Node)
        const timeoutSignal = AbortSignal.timeout(50);

        const start = Date.now();
        const result = await selectChan({
            chans: [ch.readCase()],
            signal: timeoutSignal,
            silent: true
        });
        const duration = Date.now() - start;

        // Verify it returned due to timeout, not data
        expect(result).toHaveProperty('reason');
        expect((result as any).reason.name).toBe("TimeoutError");
        expect(duration).toBeGreaterThanOrEqual(45);
    });

    test("Signal Timeout: Immediate timeout vs ready case", async () => {
        const ch = new Chan<number>(1);
        ch.tryWrite(1); // Data is ready

        // Signal that is already aborted
        const controller = new AbortController();
        controller.abort("already-dead");

        const result = await selectChan({
            chans: [ch.readCase()],
            signal: controller.signal,
            silent: true
        });

        // Even if data is ready, signal check usually happens first in selectChan
        expect(result).toHaveProperty('reason', "already-dead");
    });

    test("Signal Timeout: Racing multiple channels with timeout", async () => {
        const slowCh = new Chan<string>();
        const fastCh = new Chan<string>();
        const timeoutSignal = AbortSignal.timeout(30);

        // Slow write happens after timeout
        setTimeout(() => slowCh.tryWrite("too late"), 100);
        // Fast write happens before timeout
        setTimeout(() => fastCh.tryWrite("fast"), 10);

        const result = await selectChan({
            chans: [slowCh.readCase(), fastCh.readCase()],
            signal: timeoutSignal,
            silent: true
        });

        // Should catch fastCh before timeout triggers
        expect(result).toBe(fastCh.readCase());
        expect(fastCh.readCase().read()?.value).toBe("fast");
    });

    test("Signal Timeout: Silent mode false (should throw)", async () => {
        const ch = new Chan<number>();
        const timeoutSignal = AbortSignal.timeout(10);

        // When silent is false, selectChan should throw the error
        expect(selectChan({
            chans: [ch.readCase()],
            signal: timeoutSignal,
            silent: false
        })).rejects.toThrow();
    });
});

describe("Channel Base Functionality", () => {
    test("Buffered channel storage sequence", () => {
        const ch = new Chan<number>(2);
        expect(ch.tryWrite(1).ok).toBe(true);
        expect(ch.tryWrite(2).ok).toBe(true);
        expect(ch.tryWrite(3).ok).toBe(false); // Full

        expect(ch.tryRead().value).toBe(1);
        expect(ch.tryRead().value).toBe(2);
        expect(ch.tryRead().ok).toBe(false); // Empty
    });

    test("Unbuffered handoff (Async)", async () => {
        const ch = new Chan<number>();
        const readTask = ch.read();
        const writeResult = await ch.write(100);
        const readResult = await readTask;

        expect(writeResult.ok).toBe(true);
        expect(readResult.value).toBe(100);
    });

    test("Channel closure", async () => {
        const ch = new Chan<number>();
        expect(ch.isClosed).toBe(false);
        ch.close();
        expect(ch.isClosed).toBe(true);
        expect(ch.tryWrite(1, { silent: true }).error).toBe(true);
        expect(ch.tryRead().closed).toBe(true);
    });
});

describe("Select Operations", () => {
    test("Select with default (Non-blocking)", () => {
        const ch = new Chan<number>();
        const selected = selectChan({
            chans: [ch.readCase()],
            default: true
        });
        expect(selected).toBeNull();
    });

    test("Select randomness (Fairness)", async () => {
        const ch1 = new Chan<number>(1);
        const ch2 = new Chan<number>(1);
        ch1.tryWrite(1);
        ch2.tryWrite(2);

        const counts = { ch1: 0, ch2: 0 };
        for (let i = 0; i < 100; i++) {
            const selected = await selectChan({
                chans: [ch1.readCase(), ch2.readCase()]
            });
            if (selected === ch1.readCase()) {
                counts.ch1++;
                ch1.tryWrite(1);
            } else {
                counts.ch2++;
                ch2.tryWrite(2);
            }
        }
        expect(counts.ch1).toBeGreaterThan(10);
        expect(counts.ch2).toBeGreaterThan(10);
    });

    test("Mixed Read and Write cases", async () => {
        const ch = new Chan<number>(1);
        ch.tryWrite(1); // Full

        // Buffer is full: Read should succeed, Write should block
        const sel = await selectChan({
            chans: [ch.readCase(), ch.writeCase(2)]
        });
        expect(sel).toBe(ch.readCase());
        expect((sel as any)?.read()?.value).toBe(1);

        // Now buffer is empty: Write should succeed
        const sel2 = await selectChan({
            chans: [ch.readCase(), ch.writeCase(2)]
        });
        expect(sel2).toBe(ch.writeCase(2));
    });
});

describe("Advanced Concurrency & Signals", () => {
    test("Mixed Read-Write Stress with Background Consumer", async () => {
        const dataCh = new Chan<number>(2);
        const signalCh = new Chan<string>();
        let readCount = 0;
        let writeCount = 0;

        // Background consumer for unbuffered signal channel
        const consumer = (async () => {
            while (!signalCh.isClosed) {
                await signalCh.read({ silent: true });
                await new Promise(r => setTimeout(r, 1));
            }
        })();

        for (let i = 0; i < 20; i++) {
            if (i % 2 === 0) dataCh.tryWrite(i);

            const result = await selectChan({
                chans: [dataCh.readCase(), signalCh.writeCase("OK")]
            });

            if (result === dataCh.readCase()) {
                readCount++;
                (result as any).read();
            } else {
                writeCount++;
            }
        }

        signalCh.close();
        await consumer;
        expect(readCount + writeCount).toBe(20);
    });

    test("Signal Timeout racing with data", async () => {
        const ch = new Chan<number>();
        const timeoutSignal = AbortSignal.timeout(30);

        // Scenario: Timeout happens before data
        const start = Date.now();
        const res = await selectChan({
            chans: [ch.readCase()],
            signal: timeoutSignal,
            silent: true
        });
        expect(Date.now() - start).toBeGreaterThanOrEqual(25);
        expect(res).toHaveProperty('reason');
    });

    test("Signal already aborted priority", async () => {
        const ch = new Chan<number>(1);
        ch.tryWrite(10); // Ready to read
        const controller = new AbortController();
        controller.abort("stopped");

        const res = await selectChan({
            chans: [ch.readCase()],
            signal: controller.signal,
            silent: true
        });
        // AbortSignal should be checked before ready cases
        expect(res).toHaveProperty('reason', "stopped");
    });
});

describe("Identity-based Select Narrowing", () => {
    test("should correctly identify and execute cases across multiple rounds", async () => {
        const ch1 = new Chan<string>();
        const ch2 = new Chan<string>();

        const writeCase = ch2.writeCase("payload");
        const readCase = ch1.readCase();

        const logs: string[] = [];

        for (let i = 0; i < 3; i++) {
            // Setup preconditions for each round
            if (i === 1) {
                ch1.write("hello"); // Make read ready
            } else if (i === 2) {
                // Async consumption to make write ready (unbuffered handoff)
                setTimeout(() => ch2.read(), 100);
            }

            const selected = await selectChan({
                chans: [readCase, writeCase],
                signal: i === 0 ? AbortSignal.timeout(100) : null,
                silent: true,
            });

            // Use switch identity check for narrowing
            switch (selected) {
                case readCase:
                    // TS correctly narrows readCase here
                    const val = readCase.read()!.value;
                    logs.push(`round ${i}: read ${val}`);
                    break;
                case writeCase:
                    // TS correctly narrows writeCase here
                    const ok = writeCase.write()!.ok;
                    logs.push(`round ${i}: write ${ok}`);
                    break;
                default:
                    // Handle timeout or other reasons
                    logs.push(`round ${i}: ${(selected as any).reason.name}`);
                    break;
            }
        }

        expect(logs[0]).toContain("TimeoutError");
        expect(logs[1]).toBe("round 1: read hello");
        expect(logs[2]).toBe("round 2: write true");
    });
});