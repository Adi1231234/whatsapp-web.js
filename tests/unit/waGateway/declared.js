const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { BINDINGS } = require('../../../src/util/Injected/WaGateway/bindings');

const SRC = path.resolve(__dirname, '../../../src');
const OWN = path.join('util', 'Injected', 'WaGateway');
const sourceFiles = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) return sourceFiles(p);
        return d.name.endsWith('.js') ? [p] : [];
    });

// Whole-file matches, whitespace and newlines allowed anywhere Prettier may
// put them: it splits a long chain as `window\n    .WaGateway.module(\n 'X',\n)`.
const CALL = /WaGateway\s*\.\s*module\s*\(\s*([^)]*?)\s*,?\s*\)/g;
const NOT_A_CALL = /window\s*\.\s*WaGateway(?!\s*\.\s*(module|check)\s*\()/g;
const DESTRUCTURED = /\{[^}]*\bWaGateway\b[^}]*\}\s*=\s*window\b/g;

/** Every match of `re` in src outside the gateway, with where it is. */
function find(re, includeOwn) {
    return sourceFiles(SRC)
        .filter((f) => includeOwn || !path.relative(SRC, f).startsWith(OWN))
        .flatMap((file) => {
            const text = fs.readFileSync(file, 'utf8');
            return [...text.matchAll(re)].map((m) => ({
                arg: m[1],
                at: `${path.relative(SRC, file)}:${text.slice(0, m.index).split('\n').length}`,
            }));
        });
}

const calls = find(CALL, true);
const declared = new Set(BINDINGS.map((b) => b.module));
const name = (c) => c.arg.slice(1, -1);

describe('WaGateway: the bindings are the whole list', function () {
    it('finds the calls, however they are wrapped', function () {
        expect(calls.length).to.be.greaterThan(0);
    });

    it('is asked only for module names written out in full', function () {
        const dynamic = calls.filter((c) => !/^'[^']+'$/.test(c.arg));
        expect(
            dynamic,
            'a name the list cannot be checked against',
        ).to.deep.equal([]);
    });

    it('is asked only for modules the bindings declare', function () {
        const undeclared = calls
            .filter((c) => !declared.has(name(c)))
            .map((c) => `${name(c)} (${c.at})`);
        expect(undeclared, 'add these to WaGateway/bindings.js').to.deep.equal(
            [],
        );
    });

    it('declares nothing that no code asks for', function () {
        const used = new Set(calls.map(name));
        const stale = BINDINGS.map((b) => b.module).filter((m) => !used.has(m));
        expect(stale, 'remove these from WaGateway/bindings.js').to.deep.equal(
            [],
        );
    });

    it('is reached only as window.WaGateway, never through an alias', function () {
        // `const gw = window.WaGateway; gw.module('X')` would hide X from the
        // checks above, so outside its own folder the gateway is only ever
        // named in a direct call.
        const aliased = [...find(NOT_A_CALL), ...find(DESTRUCTURED)].map(
            (m) => m.at,
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
