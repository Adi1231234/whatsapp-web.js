import globals from 'globals';
import pluginEslintJs from '@eslint/js';
import pluginMocha from 'eslint-plugin-mocha';
import configEslintConfigPrettier from 'eslint-plugin-prettier/recommended';

// WhatsApp Web's internals are reached through one door, so that the list of
// what this library depends on inside WhatsApp is the gateway's bindings and
// nothing else. Existing direct lookups are recorded in eslint-suppressions.json
// and move behind the gateway over time; a new one fails the lint.
const THROUGH_THE_GATEWAY =
    "Reach WhatsApp's internals through window.WaGateway.module(name), and declare the module in src/util/Injected/WaGateway/bindings.js.";

export default [
    pluginEslintJs.configs.recommended,
    {
        name: 'whatsapp-web.js/default/rules',
        plugins: {
            mocha: pluginMocha,
        },
        languageOptions: {
            ecmaVersion: 2025,

            globals: {
                ...globals.browser,
                ...globals.commonjs,
                ...globals.es6,
                ...globals.node,

                Atomics: 'readonly',
                SharedArrayBuffer: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': [
                'error',
                {
                    // TODO: args can be uncommented, but there is code, that causes lint-errors
                    // args: 'all',
                    vars: 'all',
                    caughtErrorsIgnorePattern: '^ignoredError',
                },
            ],
        },
    },
    {
        name: 'whatsapp-web.js/fork/whatsapp-internals-through-the-gateway',
        files: ['src/**/*.js'],
        ignores: ['src/util/Injected/WaGateway/install.js'],
        rules: {
            'no-restricted-properties': [
                'error',
                // `require` off ANY object, so an alias of window
                // (`const w = window; w.require(...)`) is caught too. Nothing
                // in src reads a `require` property for any other reason.
                { property: 'require', message: THROUGH_THE_GATEWAY },
                {
                    object: 'window',
                    property: 'injectToFunction',
                    message: THROUGH_THE_GATEWAY,
                },
            ],
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        "CallExpression[callee.name='require'][arguments.0.value=/^WA/]",
                    message: THROUGH_THE_GATEWAY,
                },
            ],
        },
    },
    {
        // be careful, "recommended" settings object has 4 fields:
        // - name (string)
        // - plugins (object)
        // - languageOptions (object)
        // - rules (object)
        //
        // by simple "adding" any of mentioned fields to this object
        // you REPLACE the "recommended" value.
        // If you want to PATCH it - consider nested "..." spread operator
        ...pluginMocha.configs.recommended,
        name: 'whatsapp-web.js/default/mocha',

        files: ['tests/**/*'],
    },
    {
        name: 'whatsapp-web.js/default/ignores',
        ignores: [
            'node_modules',
            'dist',
            'coverage',
            'docs',
            '*.min.js',
            '*.d.ts',
            '.wa-version',
            '.wwebjs_auth',
            '.wwebjs_cache',
        ],
    },
    configEslintConfigPrettier,
];
