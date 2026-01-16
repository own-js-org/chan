import { type WriteValue, type Optional, type ReadValue } from "./types"
export interface Aborted<T> {
    reason: T
}
/**
 * Connection to a call interface
 */
export interface Connection {
    /**
     * Disconnect and cancel any unexecuted calls.
     */
    disconet(): void
}
/**
 * Cases available for select to detect
 */
export interface ChanCase {
    /**
     * reset read-write status
     */
    reset(): void
    /**
    * Try reading/writing
    */
    tryInvoke(silent?: Optional<boolean>): boolean
    /**
     * Awaiting this case to be ready
     * @param cb case completion callback
     */
    invoke(cb: (c: ChanCase, hasError?: boolean, reason?: any) => void): Connection
}

export interface ReadCase<T> extends ChanCase {
    /**
     * Get the value read from the channel
     */
    read(): ReadValue<T> | null
}
export interface WriteCase extends ChanCase {
    /**
     * Get whether the write to the chan was successful
     */
    write(): WriteValue | null
}

export interface SelectOptions {
    /**
     * If set to true, it will return null directly if no chan is ready.
     */
    default?: Optional<boolean>
    /**
     * If this is set, no exception will be thrown, which will result in an Aborted error being returned.
     */
    silent?: Optional<boolean>
    /**
     * A signal can be used to wake up a blocked select statement and make it return
     */
    signal?: Optional<AbortSignal>

    /**
     * The chan to wait for
     */
    chans?: Optional<(Optional<ReadCase<any> | WriteCase>)[]>
}
const neverPromise = new Promise<null>(() => { })
/**
 * Waiting for multiple channels at the same time
 */
export function selectChan(opts: SelectOptions & { default: true }): ChanCase | null | Aborted<any>
/**
 * Waiting for multiple channels at the same time
 */
export function selectChan(opts: SelectOptions): Promise<ChanCase | null | Aborted<any>> | ChanCase | null | Aborted<any>

export function selectChan(opts: SelectOptions): Promise<ChanCase | null | Aborted<any>> | ChanCase | null | Aborted<any> {
    const { signal, silent } = opts
    if (signal?.aborted) {
        if (silent) {
            return {
                reason: signal.reason
            }
        }
        throw signal.reason
    }
    const chans = opts.chans?.filter((v) => v ? true : false) as ChanCase[]
    if (!chans || !chans.length) {
        if (opts.default) {
            return null
        }
        if (signal) {
            return new Promise<Aborted<any>>((resolve, reject) => {
                signal.addEventListener('abort', () => {
                    if (silent) {
                        resolve({
                            reason: signal.reason,
                        })
                    } else {
                        reject(signal.reason)
                    }
                }, { once: true })
            })
        }
        return neverPromise
    }


    for (const chan of chans) {
        chan.reset()
    }

    // shuffle the case to avoid the case in front of the array is always executed when multiple cases are completed at the same time
    shuffle(chans, chans.length)

    // check ready case
    for (const chan of chans) {
        if (chan.tryInvoke(silent)) {
            return chan
        }
    }
    if (opts.default) { // return default
        return null
    }
    return new Promise((resolve, reject) => {
        const conns = new Array<Connection>(chans.length)
        const cleanup = (aborted?: boolean) => {
            if (!aborted) {
                signal?.removeEventListener('abort', onAbort)
            }
            for (const conn of conns) {
                conn.disconet()
            }
        }
        const cb = (c: ChanCase, hasError?: boolean, reason?: any) => {
            cleanup()
            if (hasError) {
                if (silent) {
                    resolve({
                        reason: reason,
                    })
                } else {
                    reject(reason)
                }
            } else {
                resolve(c)
            }
        }
        const onAbort = () => {
            cleanup(true)
            if (silent) {
                resolve({
                    reason: signal?.reason,
                })
            } else {
                reject(signal?.reason)
            }
        }
        for (let i = 0; i < chans.length; i++) {
            conns[i] = chans[i]!.invoke(cb)
        }
        signal?.addEventListener('abort', onAbort, { once: true })
    })
}
function shuffle(arrs: Array<any>, c: number) {
    let r
    while (c !== 0) {
        r = Math.floor(Math.random() * c)
        c--
        // swap
        [arrs[c], arrs[r]] = [arrs[r], arrs[c]]
    }
    return arrs
}
