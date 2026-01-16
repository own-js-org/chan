import { Completer } from './completer'
import { noResult, Actions, Ring } from './container'
import { ChannelError } from './types'


type ReadCallback = (val: IteratorResult<any>) => void
/**
 * Define a read action
 */
class ReadAction {
    /**
     * @param reader Associated reader
     * @param callback Execute read callback
     */
    constructor(private readonly reader: Reader,
        private readonly callback: ReadCallback,
    ) { }
    /**
     * Execute data read callback
     */
    invoke(val: IteratorResult<any>) {
        this.callback(val)
    }
    /**
     * Release action
     */
    disconet() {
        this.reader.disconet(this)
    }
}
/**
 * Define a data reader that allows multiple devices to read data from it simultaneously.
 */
class Reader {
    private closed = false
    private actions = new Actions<ReadAction>()
    get isEmpty(): boolean {
        return this.actions.length === 0
    }
    /**
     * Give the data to a random reader.
     */
    invoke(val: IteratorResult<any>) {
        const actions = this.actions
        switch (actions.length) {
            case 0:
                throw new ChannelError('reader empty')
            case 1:
                actions.pop().invoke(val)
                return
        }
        const i = Math.floor(Math.random() * actions.length)
        actions.removeBy(i).invoke(val)
    }
    /**
     * Close the reader and notify all readers.
     */
    close() {
        if (this.closed) {
            return
        }
        this.closed = true
        const actions = this.actions
        if (actions.length !== 0) {
            for (const action of actions) {
                action.invoke(noResult)
            }
            actions.clear()
        }
    }
    /**
     * Create a reading action
     */
    connect(callback: ReadCallback): ReadAction {
        const action = new ReadAction(this, callback)
        this.actions.push(action)
        return action
    }
    /**
     * Release reading action
     */
    disconet(action: ReadAction) {
        this.actions.remove(action)
    }
}

type WriteCallback = (val?: true, reason?: any) => void

/**
 * Define a write action
 */
class WirteAction {
    /**
     * @param writer Associated writer
     * @param value 
     * @param callback Notification write result
     */
    constructor(private readonly writer: Writer,
        public readonly value: any,
        private readonly callback: WriteCallback,
    ) { }
    invoke() {
        this.callback(true)
    }
    close(reason: any) {
        this.callback(undefined, reason)
    }
    disconet() {
        this.writer.disconet(this)
    }
}
class Writer {
    private closed_ = false
    private actions = new Actions<WirteAction>()
    get isEmpty(): boolean {
        return this.actions.length === 0
    }
    invoke() {
        const actions = this.actions
        switch (actions.length) {
            case 0:
                throw new ChannelError("writer empty")
            case 1:
                const p = actions.pop()
                p.invoke()
                return p.value
        }
        const i = Math.floor(Math.random() * actions.length)
        const p = actions.removeBy(i)
        p.invoke()
        return p.value
    }
    close() {
        if (this.closed_) {
            return
        }
        this.closed_ = true
        const actions = this.actions
        if (actions.length !== 0) {
            const err = new ChannelError('channel already closed')
            for (const action of actions) {
                action.close(err)
            }
            actions.clear()
        }
    }
    connect(val: any, callback: WriteCallback): WirteAction {
        const result = new WirteAction(this, val, callback)
        this.actions.push(result)
        return result
    }
    disconet(action: WirteAction) {
        this.actions.remove(action)
    }
}

export class RW<T> {
    private list: Ring<T> | undefined
    constructor(buf: number) {
        if (buf > 0) {
            this.list = new Ring<T>(new Array<T>(buf))
        }
    }
    private r_ = new Reader()
    private w_ = new Writer()
    tryRead(): IteratorResult<any> | undefined {
        // read cache
        const list = this.list
        if (list) {
            const result = list.pop()
            if (!result.done) {
                return result
            }
        }

        // closed?
        if (this.isClosed) {
            return
        }
        // read from writer
        const w = this.w_
        if (w.isEmpty) { // no writer
            return noResult
        }
        return {
            value: w.invoke(),
        }
    }
    read(callback: ReadCallback): ReadAction {
        // set read cb
        return this.r_.connect(callback)
    }
    tryWrite(val: T): boolean | undefined {
        if (this.isClosed) {
            return
        }
        const r = this.r_
        if (r.isEmpty) { // no reader
            // push to cache
            return this.list?.push(val) ?? false
        }
        r.invoke({
            value: val,
        })
        return true
    }
    write(val: T, callback: WriteCallback): WirteAction {
        // set write cb
        return this.w_.connect(val, callback)
    }
    close(): boolean {
        if (this.isClosed) {
            return false
        }
        this.isClosed = true
        this.w_.close()
        this.r_.close()
        const closed = this.closed_
        if (closed) {
            this.closed_ = undefined
            closed.resolve(null)
        }
        return true
    }
    wait(): null | Promise<null> {
        if (this.isClosed) {
            return null
        }
        let closed = this.closed_
        if (closed) {
            return closed.promise
        }
        closed = new Completer<null>()
        this.closed_ = closed
        return closed.promise
    }
    private closed_: Completer<null> | undefined
    isClosed = false
    get length(): number {
        return this.list?.length ?? 0
    }
    get capacity(): number {
        return this.list?.capacity ?? 0
    }
}