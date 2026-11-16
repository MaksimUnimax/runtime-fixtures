// Compile the real client component with the locked Next SWC/webpack toolchain.
// Output is disposable test code, never a new product page or release artifact.
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../..');
const out = path.resolve(process.argv[2]);
if (path.dirname(out)!=='/dev/shm' || !path.basename(out).startsWith('alisa-r5-period-ui-')) throw Error('DISPOSABLE_OUTPUT_REQUIRED');
const req = createRequire(path.join(root, 'apps/web/package.json'));
const swc = req('next/dist/build/swc');
const webpack = req('next/dist/compiled/webpack/webpack').webpack;
(async () => {
  fs.mkdirSync(out, {mode:0o700});
  await swc.loadBindings();
  for (const name of ['model.ts', 'view.tsx']) {
    const src = path.join(root, 'apps/web/src/app/app/parameters', name);
    const result = await swc.transform(fs.readFileSync(src, 'utf8'), {
      filename:src, jsc:{parser:{syntax:'typescript',tsx:name.endsWith('.tsx')},
        transform:{react:{runtime:'automatic'}}}, module:{type:'commonjs'}, isModule:true,
    });
    fs.writeFileSync(path.join(out, name.replace(/\.tsx?$/, '.js')), result.code);
  }
  fs.writeFileSync(path.join(out,'entry.js'), `const React=require('react');
const {createRoot}=require('react-dom/client');const {ParametersView}=require('./view');
createRoot(document.getElementById('root')).render(React.createElement(ParametersView,{
stores:[{id:'11111111-1111-4111-8111-111111111111',name:'Synthetic store',provider:'OZON',status:'ACTIVE'}],
initialStore:'11111111-1111-4111-8111-111111111111',recoveryScope:'synthetic-period-fixture'}));`);
  const compiler = webpack({mode:'development',devtool:false,entry:path.join(out,'entry.js'),
    output:{path:out,filename:'bundle.js'},resolve:{modules:[path.join(root,'apps/web/node_modules'),path.join(root,'node_modules'),'node_modules']},
    optimization:{minimize:false},performance:{hints:false}});
  compiler.run((error,stats) => {
    compiler.close(() => {});
    if (error || stats.hasErrors()) {process.stderr.write(String(error||stats.toString({all:false,errors:true})));process.exitCode=1;}
    else process.stdout.write(JSON.stringify({status:'BUILT',bytes:fs.statSync(path.join(out,'bundle.js')).size})+'\n');
  });
})().catch(error=>{process.stderr.write(String(error));process.exitCode=1;});
