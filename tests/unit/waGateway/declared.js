const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { BINDINGS } = require('../../../src/util/Injected/WaGateway/bindings');

const SRC = path.resolve(__dirname, '../../../src');
const sourceFiles = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) return sourceFiles(p);
        return d.name.endsWith('.js') ? [p] : [];
    });

/** Every `WaGateway.module(...)` call in src, with its argument as written. */
function gatewayCalls() {
    return sourceFiles(SRC).flatMap((file) =>
        [
            ...fs
                .readFileSync(file, 'utf8')
                .matchAll(/WaGateway\.module\(\s*([^)]*?)\s*\)/g),
        ].map((m) => ({ file: path.relative(SRC, file), arg: m[1] })),
    );
}

const calls = gatewayCalls();
const declared = new Set(BINDINGS.map((b) => b.module));

describe('WaGateway: the bindings are the whole list', function () {
    it('is asked only for module names written out in full', function () {
        const dynamic = calls.filter((c) => !/^'[^']+'$/.test(c.arg));
        expect(
            dynamic,
            'a name the list cannot be checked against',
        ).to.deep.equal([]);
    });

    it('is asked only for modules the bindings declare', function () {
        const undeclared = calls
            .map((c) => Object.assign({ module: c.arg.slice(1, -1) }, c))
            .filter((c) => !declared.has(c.module))
            .map((c) => `${c.module} (${c.file})`);
        expect(undeclared, 'add these to WaGateway/bindings.js').to.deep.equal(
            [],
        );
    });

    it('declares nothing that no code asks for', function () {
        const used = new Set(calls.map((c) => c.arg.slice(1, -1)));
        const stale = BINDINGS.map((b) => b.module).filter((m) => !used.has(m));
        expect(stale, 'remove these from WaGateway/bindings.js').to.deep.equal(
            [],
        );
    });

    it('is reached only as window.WaGateway, never through an alias', function () {
        // `const gw = window.WaGateway; gw.module('X')` would hide X from the
        // checks above, so outside its own folder the gateway is only ever
        // named in a direct call.
        const own = path.join('util', 'Injected', 'WaGateway');
        const aliased = sourceFiles(SRC)
            .filter((f) => !path.relative(SRC, f).startsWith(own))
            .flatMap((file) =>
                fs
                    .readFileSync(file, 'utf8')
                    .split('\n')
                    .map((line, i) => ({
                        line,
                        at: `${path.relative(SRC, file)}:${i + 1}`,
                    }))
                    .filter(
                        ({ line }) =>
                            /window\.WaGateway(?!\.(module|check)\()/.test(
                                line,
                            ) || /\bWaGateway\b[^}]*\}\s*=\s*window/.test(line),
                    )
                    .map(({ at }) => at),
            );
        expect(
            aliased,
            'call window.WaGateway.module(...) directly',
        ).to.deep.equal([]);
    });

    it('declares each module once', function () {
        const names = BINDINGS.map((b) => b.module);
        expect(names).to.have.length(new Set(names).size);
    });
});
