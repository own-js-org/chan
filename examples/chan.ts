import { Chan } from '../index'

const ch = new Chan<number>(5);
[10, 20, 30].forEach(v => ch.tryWrite(v));
ch.close();

const results: number[] = [];
for await (const val of ch) {
    results.push(val);
}