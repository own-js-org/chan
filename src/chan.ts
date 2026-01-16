import { RW } from './rw'
import type { ChanCase, Connection, ReadCase, WriteCase } from './select'
import {
    ChannelError, type Optional, type ReadChannel,
    type ReadOptions, type ReadValue,
    type WriteChannel, type WriteOptions, type WriteValue,
} from './types'
export class Chan<T> implements ReadChannel<T>, WriteChannel<T> {
    private static never_: undefined | Chan<any>
    /**
     * Returns a chan that will never have a value, usually used as some token
     */
    static get never(): ReadChannel<any> {
        return Chan.never_ || (Chan.never_ = new Chan<any>())
    }
    private static closed_: undefined | Chan<any>
    /**
     * Returns an alreay closed chan, usually used as some token
     */
    static get closed(): Chan<any> {
        if (!Chan.closed_) {
            Chan.closed_ = new Chan<any>()
            Chan.closed_.close()
        }
        return Chan.closed_
    }
    /**
     * Low-level reader/writer
     */
    private readonly rw_: RW<T>

    /**
     * @params buffered size, if greater than 0 enable buffering for the channel
     */
    constructor(buf = 0) {
        this.rw_ = new RW<T>(Math.floor(buf))
    }
    read(opts?: Optional<ReadOptions>): ReadValue<T> | Promise<ReadValue<T>> {
        const val = this.tryRead(opts)
        if (val.closed !== false || val.ok) {
            return val
        }
        const rw = this.rw_
        const signal = opts?.signal
        const silent = opts?.silent
        return new Promise((resolve, reject) => {
            const cleanup = (aborted?: boolean) => {
                if (aborted) {
                    action.disconet()
                } else {
                    signal?.removeEventListener('abort', onAbort)
                }
            }
            const action = rw.read((val) => {
                cleanup()
                resolve(val.done ? {
                    closed: true,
                    ok: false,
                    value: null,
                } : {
                    closed: false,
                    ok: true,
                    value: val.value,
                })
            })
            const onAbort = () => {
                cleanup(true)
                if (silent) {
                    resolve({
                        closed: null,
                        reason: signal?.reason,
                        ok: false,
                        value: null,
                    })
                } else {
                    reject(signal?.reason)
                }
            }
            signal?.addEventListener('abort', onAbort, { once: true })
        })
    }
    tryRead(opts?: Optional<ReadOptions>): ReadValue<T> {
        const signal = opts?.signal
        const silent = opts?.silent
        if (signal?.aborted) {
            if (silent) {
                return {
                    closed: null,
                    reason: signal.reason,
                    ok: false,
                    value: null,
                }
            }
            throw signal.reason
        }

        const val = this.rw_.tryRead()
        if (val === undefined) {
            return {
                closed: true,
                ok: false,
                value: null,
            }
        }
        return val.done ? {
            closed: false,
            ok: false,
            value: null,
        } : {
            closed: false,
            ok: true,
            value: val.value,
        }
    }
    write(val: T, opts?: Optional<WriteOptions>): WriteValue | Promise<WriteValue> {
        const value = this.tryWrite(val, opts)
        if (value.ok || value.error) {
            return value
        }
        const signal = opts?.signal
        const silent = opts?.silent
        return new Promise((resolve, reject) => {
            const cleanup = (aborted?: boolean) => {
                if (aborted) {
                    action.disconet()
                } else {
                    signal?.removeEventListener('abort', onAbort)
                }
            }
            const action = this.rw_.write(val, (ok, reason) => {
                cleanup()
                if (ok === undefined) {
                    if (silent) {
                        resolve({
                            ok: false,
                            error: true,
                            reason: reason,
                        })
                    } else {
                        reject(reason)
                    }
                } else {
                    resolve({
                        ok: ok,
                    })
                }
            })
            const onAbort = () => {
                cleanup(true)
                if (silent) {
                    resolve({
                        ok: false,
                        error: true,
                        reason: signal?.reason,
                    })
                } else {
                    reject(signal?.reason)
                }
            }
            signal?.addEventListener('abort', onAbort, { once: true })
        })
    }
    tryWrite(val: T, opts?: Optional<WriteOptions>): WriteValue {
        const signal = opts?.signal
        const silent = opts?.silent
        if (signal?.aborted) {
            if (silent) {
                return {
                    ok: false,
                    error: true,
                    reason: signal.reason
                }
            }
            throw signal.reason
        }
        const rw = this.rw_
        const result = rw.tryWrite(val)
        if (result === undefined) {
            const err = new ChannelError('channel already closed')
            if (silent) {
                return {
                    ok: false,
                    error: true,
                    reason: err,
                }
            }
            throw err
        } else if (result) {
            return {
                ok: true,
            }
        }
        // Unwritable
        return {
            ok: false,
        }
    }
    readCase(): ReadCase<T> {
        return new _ReadCase<T>(this, this.rw_)
    }
    writeCase(val: T): WriteCase {
        return new _WriteCase(this, this.rw_, val)
    }
    close(): boolean {
        return this.rw_.close()
    }
    wait(): null | Promise<null> {
        return this.rw_.wait()
    }
    get isClosed(): boolean {
        return this.rw_.isClosed
    }
    get length(): number {
        return this.rw_.length
    }
    get capacity(): number {
        return this.rw_.capacity
    }
    values(opts?: ReadOptions): AsyncIterable<ReadValue<T>> {
        return new ChanIterator(this, opts)
    }
    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
        while (true) {
            const { closed, ok, value, reason } = await this.read()
            if (closed) {
                break
            }
            if (ok) {
                yield value!
            }
            throw reason
        }
    }
}
class ChanIterator<T> {
    readonly opts?: ReadOptions
    constructor(readonly ch: Chan<T>, opts?: ReadOptions) {
        if (opts) {
            this.opts = {
                signal: opts.signal,
                silent: opts.silent,
            }
        }
    }
    async *[Symbol.asyncIterator](): AsyncGenerator<ReadValue<T>> {
        const ch = this.ch
        const opts = this.opts
        while (true) {
            const val = await ch.read(opts)
            if (val.closed) {
                break
            }
            yield val
        }
    }
}

class _ReadCase<T> implements ReadCase<T> {
    constructor(private readonly ch: Chan<T>, private readonly rw: RW<T>) {
    }
    private value_: ReadValue<T> | null = null
    read(): ReadValue<T> | null {
        return this.value_
    }
    reset(): void {
        this.value_ = null
    }
    tryInvoke(): boolean {
        const val = this.rw.tryRead()
        if (val === undefined) {
            this.value_ = {
                closed: true,
                ok: false,
                value: null,
            }
            return true
        } else if (val.done) {
            return false
        } else {
            this.value_ = {
                closed: false,
                ok: true,
                value: val.value,
            }
            return true
        }
    }
    invoke(cb: (c: ChanCase) => void): Connection {
        return this.rw.read((val: IteratorResult<any>) => {
            if (val.done) {
                this.value_ = {
                    closed: true,
                    ok: true,
                    value: val.value,
                }
            } else {
                this.value_ = {
                    closed: false,
                    ok: true,
                    value: val.value,
                }
            }
            cb(this)
        })
    }
}
class _WriteCase<T> implements WriteCase {
    constructor(private readonly ch: Chan<T>,
        private readonly rw: RW<T>,
        private readonly val: T,
    ) {
    }
    private value_: WriteValue | null = null
    write(): WriteValue | null {
        return this.value_
    }
    reset() {
        this.value_ = null
    }
    tryInvoke(silent?: Optional<boolean>): boolean {
        const ch = this.ch
        const val = ch.tryWrite(this.val, { silent: silent })
        if (val.ok === undefined) {
            this.value_ = {
                ok: false,
                error: true,
                reason: val.reason,
            }
            return true
        } else if (val.ok) {
            this.value_ = {
                ok: true,
            }
            return true
        }
        return false
    }
    invoke(cb: (c: ChanCase, hasError?: boolean, reason?: any) => void): Connection {
        const rw = this.rw
        return rw.write(this.val, (val?: true, reason?: any) => {
            if (val === undefined) {
                this.value_ = {
                    ok: false,
                    error: true,
                    reason: reason,
                }
                cb(this, true, reason)
            } else {
                this.value_ = {
                    ok: true,
                }
                cb(this)
            }
        })
    }
}