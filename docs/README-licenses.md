# Kiểm kê giấy phép dependency

Chạy lệnh này ở thư mục gốc của repo, sau `bun install`:

```bash
find node_modules -name package.json -path '*node_modules/*/package.json' \
  -not -path '*/node_modules/*/node_modules/*/*/package.json' |
while read f; do
  node -e 'const p=require(require("path").resolve(process.argv[1]));if(!p.name||!p.version)process.exit();
    const l=typeof p.license==="string"?p.license:JSON.stringify(p.license||p.licenses);
    console.log(l+"\t"+p.name+"@"+p.version)' "$f"
done | sort -u
```

Giấy phép được chấp nhận: MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, Unlicense, 0BSD.
Package dùng giấy phép khác thì phải được duyệt trước khi thêm vào.
