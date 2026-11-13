package com.mjmj.player;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 极简 JSON 解析/序列化（纯 JDK，够用即可） */
public class MiniJson {

    // ---------- 序列化 ----------
    public static String stringify(Object o) {
        if (o == null) return "null";
        if (o instanceof String) return quote((String) o);
        if (o instanceof Boolean || o instanceof Long || o instanceof Integer || o instanceof Double || o instanceof Float) return String.valueOf(o);
        if (o instanceof Map) {
            Map<?, ?> m = (Map<?, ?>) o;
            StringBuilder sb = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (!first) sb.append(",");
                first = false;
                sb.append(quote(String.valueOf(e.getKey()))).append(":").append(stringify(e.getValue()));
            }
            return sb.append("}").toString();
        }
        if (o instanceof List) {
            List<?> l = (List<?>) o;
            StringBuilder sb = new StringBuilder("[");
            boolean first = true;
            for (Object v : l) {
                if (!first) sb.append(",");
                first = false;
                sb.append(stringify(v));
            }
            return sb.append("]").toString();
        }
        return quote(String.valueOf(o));
    }

    public static String quote(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append("\"").toString();
    }

    // ---------- 解析 ----------
    public static Object parse(String s) {
        return new Parser(s).parseValue();
    }

    private static class Parser {
        final String s;
        int i = 0;

        Parser(String s) { this.s = s; }

        Object parseValue() {
            skipWs();
            char c = peek();
            if (c == '{') return parseObject();
            if (c == '[') return parseArray();
            if (c == '"') return parseString();
            return parseLiteral();
        }

        Map<String, Object> parseObject() {
            Map<String, Object> m = new LinkedHashMap<>();
            expect('{');
            skipWs();
            if (peek() == '}') { i++; return m; }
            while (true) {
                skipWs();
                String k = parseString();
                skipWs();
                expect(':');
                Object v = parseValue();
                m.put(k, v);
                skipWs();
                char c = peek();
                if (c == ',') { i++; continue; }
                if (c == '}') { i++; break; }
                throw new RuntimeException("JSON 对象缺少逗号/右括号 @" + i);
            }
            return m;
        }

        List<Object> parseArray() {
            List<Object> l = new ArrayList<>();
            expect('[');
            skipWs();
            if (peek() == ']') { i++; return l; }
            while (true) {
                l.add(parseValue());
                skipWs();
                char c = peek();
                if (c == ',') { i++; continue; }
                if (c == ']') { i++; break; }
                throw new RuntimeException("JSON 数组缺少逗号/右括号 @" + i);
            }
            return l;
        }

        String parseString() {
            expect('"');
            StringBuilder sb = new StringBuilder();
            while (true) {
                if (i >= s.length()) throw new RuntimeException("JSON 字符串未闭合");
                char c = s.charAt(i++);
                if (c == '"') break;
                if (c == '\\') {
                    char e = s.charAt(i++);
                    switch (e) {
                        case '"': sb.append('"'); break;
                        case '\\': sb.append('\\'); break;
                        case '/': sb.append('/'); break;
                        case 'n': sb.append('\n'); break;
                        case 'r': sb.append('\r'); break;
                        case 't': sb.append('\t'); break;
                        case 'b': sb.append('\b'); break;
                        case 'f': sb.append('\f'); break;
                        case 'u':
                            sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                            i += 4;
                            break;
                        default: sb.append(e);
                    }
                } else sb.append(c);
            }
            return sb.toString();
        }

        Object parseLiteral() {
            StringBuilder sb = new StringBuilder();
            while (i < s.length()) {
                char c = s.charAt(i);
                if (c == ',' || c == '}' || c == ']' || Character.isWhitespace(c)) break;
                sb.append(c);
                i++;
            }
            String t = sb.toString().trim();
            if (t.equals("null")) return null;
            if (t.equals("true")) return Boolean.TRUE;
            if (t.equals("false")) return Boolean.FALSE;
            if (t.indexOf('.') >= 0 || t.indexOf('e') >= 0 || t.indexOf('E') >= 0) return Double.parseDouble(t);
            return Long.parseLong(t);
        }

        char peek() {
            if (i >= s.length()) throw new RuntimeException("JSON 意外结束");
            return s.charAt(i);
        }

        void expect(char c) {
            if (peek() != c) throw new RuntimeException("期望 '" + c + "' @" + i);
            i++;
        }

        void skipWs() {
            while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
        }
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> obj(Object o) { return (Map<String, Object>) o; }

    @SuppressWarnings("unchecked")
    public static List<Object> arr(Object o) { return (List<Object>) o; }

    public static String str(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v == null ? null : String.valueOf(v);
    }

    public static Long num(Map<String, Object> m, String k) {
        Object v = m.get(k);
        if (v == null) return null;
        if (v instanceof Number) return ((Number) v).longValue();
        try { return Long.parseLong(String.valueOf(v)); } catch (Exception e) { return null; }
    }
}
