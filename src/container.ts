export const noResult = {
    done: true,
    value: undefined,
}
/**
 * a ring buffer
 * @internal
 */
export class Ring<T> {
    private offset_ = 0
    private size_ = 0
    constructor(private readonly arrs: Array<T>) {
    }
    get length(): number {
        return this.size_
    }
    get capacity(): number {
        return this.arrs.length
    }
    push(val: T): boolean {
        const arrs = this.arrs
        const size = this.size_
        if (size == arrs.length) {
            return false
        }
        arrs[(this.offset_ + size) % arrs.length] = val
        this.size_++
        return true
    }
    pop(): IteratorResult<T> {
        const size = this.size_
        if (size == 0) {
            return noResult as any
        }
        const val = this.arrs[this.offset_++]!
        if (this.offset_ == this.arrs.length) {
            this.offset_ = 0
        }
        this.size_--
        return {
            done: false,
            value: val,
        }
    }
}

/**
 * Store the read and write operations to be performed.
 * @internal
 */
export class Actions<T> {
    /**
     * Stored actions list
     * @remarks
     * Note that the content is in random order.
     */
    private actions: T[] = []
    /**
     * Actions index
     */
    private keys = new Map<T, number>()
    /**
     * Number of stored actions
     */
    get length(): number {
        return this.actions.length
    }
    /**
     * Delete the last action and return it. 
     * @remarks
     * For efficiency reasons, the caller needs to ensure that the current list is not empty.
     */
    pop() {
        const val = this.actions.pop()!
        this.keys.delete(val)
        return val
    }
    /**
     * Delete action based on index. 
     * @remarks
     * For efficiency reasons, the caller needs to ensure that index i is valid.
     */
    removeBy(i: number): T {
        const vals = this.actions
        const swap = vals.pop()!
        const keys = this.keys
        if (i == vals.length) {
            keys.delete(swap)
            return swap
        }
        // The element to be deleted will be replaced with the last element of the original list.
        const val = vals[i]!
        keys.delete(val)
        vals[i] = swap
        keys.set(swap, i)
        return val
    }
    /**
     * Delete specified content
     */
    remove(val: T) {
        const keys = this.keys
        const vals = this.actions
        const i = keys.get(val) ?? -1
        if (i < 0) {
            return
        }
        const swap = vals.pop()!
        keys.delete(val)
        if (i == vals.length) {
            return
        }
        // The element to be deleted will be replaced with the last element of the original list.
        vals[i] = swap
        keys.set(swap, i)
    }
    /**
     * Clear action list
     */
    clear() {
        this.actions = []
        this.keys.clear()
    }
    /**
     * add an action
     */
    push(val: T) {
        const vals = this.actions
        const value = vals.length
        vals.push(val)
        this.keys.set(val, value)
    }
    /**
     * iterators
     */
    [Symbol.iterator](): Iterator<T> {
        const actions = this.actions
        let i = 0
        return {
            next() {
                if (i < actions.length) {
                    return { value: actions[i++]!, done: false }
                }
                return { done: true, value: undefined }
            },
        }
    }
}