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
    constructor(public reader?: Reader,
        public callback?: ReadCallback,
    ) { }
    /**
     * Execute data read callback
     */
    invoke(val: IteratorResult<any>) {
        const cb = this.callback
        if (cb) {
            cb(val)
        }
    }
    /**
     * Release action
     */
    disconnect() {
        const reader = this.reader
        if (reader) {
            this.reader = undefined
            this.callback = undefined
            reader.disconnect(this)
        }
    }

}
/**
 * Define a data reader that allows multiple devices to read data from it simultaneously.
 */
class Reader {
    static list?: Ring<ReadAction>
    create(callback: ReadCallback) {
        const list = Reader.list
        if (list) {
            const action = list.pop(true)
            if (action) {
                action.reader = this
                action.callback = callback
                return action
            }
        } else {
            Reader.list = new Ring<ReadAction>(new Array(128))
        }
        return new ReadAction(this, callback)
    }
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
        const action = this.create(callback)
        this.actions.push(action)
        return action
    }
    /**
     * Release reading action
     */
    disconnect(action: ReadAction) {
        this.actions.remove(action)
        Reader.list?.push(action)
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
    constructor(public writer?: Writer,
        public value?: any,
        public callback?: WriteCallback,
    ) { }
    invoke() {
        const cb = this.callback
        if (cb) {
            cb(true)
        }
    }
    close(reason: any) {
        const cb = this.callback
        if (cb) {
            cb(undefined, reason)
        }
    }
    disconnect() {
        const writer = this.writer
        if (writer) {
            this.writer = undefined
            this.callback = undefined
            this.value = undefined
            writer.disconnect(this)
        }
    }
}
class Writer {
    static list?: Ring<WirteAction>
    create(value: any, callback: WriteCallback) {
        const list = Writer.list
        if (list) {
            const action = list.pop(true)
            if (action) {
                action.writer = this
                action.value = value
                action.callback = callback
            }
        } else {
            Writer.list = new Ring<WirteAction>(new Array(128))
        }
        return new WirteAction(this, value, callback)
    }
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
                const val = p.value
                p.invoke()
                return val
        }
        const i = Math.floor(Math.random() * actions.length)
        const p = actions.removeBy(i)
        const val = p.value
        p.invoke()
        return val
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
    connect(value: any, callback: WriteCallback): WirteAction {
        const action = this.create(value, callback)
        this.actions.push(action)
        return action
    }
    disconnect(action: WirteAction) {
        this.actions.remove(action)
        Writer.list?.push(action)
    }
}

export class RW<T> {
    private list: Ring<T> | undefined
    constructor(buf: number) {
        if (buf > 0) {
            this.list = new Ring<T>(new Array(buf))
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
                const w = this.w_
                if (!w.isEmpty) {
                    list.push(w.invoke())
                }
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