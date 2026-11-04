import path from "node:path";
import {fileURLToPath} from "node:url";
export default {output: "standalone", outputFileTracingRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), experimental: {cpus: 1}, poweredByHeader: false,
  async headers(){return [{source:'/:path*',headers:[{key:'Referrer-Policy',value:'no-referrer'},{key:'X-Robots-Tag',value:'noindex, nofollow'},{key:'X-Content-Type-Options',value:'nosniff'}]}];}};
