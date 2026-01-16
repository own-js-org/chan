import { Chan, selectChan } from '../index'

const ch1 = new Chan<string>();
const ch2 = new Chan<string>();

const writeCase = ch2.writeCase("payload");
const readCase = ch1.readCase()
for (let i = 0; i < 3; i++) {
    switch (i) {
        case 1:
            ch1.write('hello')
            break
        case 2:
            ch2.read()
            break
    }
    const selected = await selectChan({
        chans: [
            ch1.readCase(),
            writeCase,
        ],
        signal: i == 0 ? AbortSignal.timeout(100) : null,
        silent: true,
    });
    switch (selected) {
        case readCase:
            console.log(i, "Read from ch1:", readCase.read()!.value);
            break
        case writeCase:
            console.log(i, "Successfully wrote to ch2:", writeCase.write()!.ok);
            break
        default:
            console.log(i, `${selected.reason}`)
            break
    }
}