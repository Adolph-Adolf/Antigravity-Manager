#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""精确删除 12 个语言包里的推广相关 i18n key（按行范围手术，保持原格式不动）。
删除项：
  1) 顶层 "apiKeyFun": { ... } 整块
  2) "nav" -> "apikey_fun" 单行
每个文件写回前都用 json.loads 校验，并打印删除前后 key 差集作为证据。
"""
import glob
import json
import re
import sys

files = sorted(glob.glob('src/locales/*.json'))
ok = True

for f in files:
    raw = open(f, encoding='utf-8').read()
    lines = raw.split('\n')
    before = json.loads(raw)
    before_top = set(before.keys())
    before_nav = set(before.get('nav', {}).keys())

    # --- 1) 顶层 apiKeyFun 块 ---
    start = None
    for i, l in enumerate(lines):
        if re.match(r'^\s*"apiKeyFun"\s*:\s*\{', l):
            start = i
            break
    removed_block = None
    if start is not None:
        depth = 0
        end = None
        for j in range(start, len(lines)):
            depth += lines[j].count('{') - lines[j].count('}')
            if depth == 0:
                end = j
                break
        if end is None:
            print('!! %s 找不到 apiKeyFun 结束行' % f)
            sys.exit(1)
        if lines[end].rstrip().endswith(','):
            pass  # 自身带逗号，整块连逗号一起删
        else:
            # 它是最后一个成员，删掉后要把上一行的尾逗号去掉
            k = start - 1
            while k >= 0 and lines[k].strip() == '':
                k -= 1
            if not lines[k].rstrip().endswith(','):
                print('!! %s 末尾逗号处理异常: %r' % (f, lines[k]))
                sys.exit(1)
            lines[k] = lines[k].rstrip()[:-1]
        del lines[start:end + 1]
        removed_block = (start + 1, end + 1)  # 1-based 行号，方便报告

    # --- 2) nav.apikey_fun 单行 ---
    removed_nav = None
    for i, l in enumerate(lines):
        if re.match(r'^\s*"apikey_fun"\s*:', l):
            removed_nav = i + 1
            del lines[i]
            break

    out = '\n'.join(lines)
    after = json.loads(out)  # 校验：解析失败就抛异常，文件不会被写坏
    after_top = set(after.keys())
    after_nav = set(after.get('nav', {}).keys())

    open(f, 'w', encoding='utf-8', newline='\n').write(out)

    print('%-22s 块删除行=%s  nav删除行=%s  |  顶层key减少=%s  nav key减少=%s'
          % (f.replace('\\', '/'), removed_block, removed_nav,
             sorted(before_top - after_top), sorted(before_nav - after_nav)))

    if before_top - after_top != {'apiKeyFun'} or before_nav - after_nav - {'apikey_fun'} != set():
        print('   ^^ 非预期删除，请检查！')
        ok = False

print('\n结果:', 'OK — 每个文件都只删了 apiKeyFun 块与 nav.apikey_fun' if ok else 'ERR — 存在非预期删除')
