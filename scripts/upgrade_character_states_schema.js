const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "../data/novelforge.db");
const db = new Database(dbPath);

console.log("开始升级角色动态账本数据库结构...\n");

// 1. 为 novels 表增加 state_template 字段
console.log("1. 为 novels 表增加 state_template 字段...");
try {
  const novelColumns = db.prepare("PRAGMA table_info(novels)").all();
  if (!novelColumns.some(c => c.name === "state_template")) {
    db.prepare("ALTER TABLE novels ADD COLUMN state_template TEXT DEFAULT 'xuanhuan'").run();
    console.log("   ✓ 已添加 state_template 字段（默认: xuanhuan）");
  } else {
    console.log("   • state_template 字段已存在");
  }
} catch (err) {
  console.error("   ✗ 失败:", err.message);
}

// 2. 为 character_states 表增加新字段
console.log("\n2. 为 character_states 表增加扩展字段...");

const newColumns = [
  { name: "key_relationships", type: "TEXT DEFAULT ''" },
  { name: "recent_events", type: "TEXT DEFAULT ''" },
  { name: "type_specific_data", type: "TEXT DEFAULT '{}'" }
];

try {
  const stateColumns = db.prepare("PRAGMA table_info(character_states)").all();

  for (const col of newColumns) {
    if (!stateColumns.some(c => c.name === col.name)) {
      db.prepare(`ALTER TABLE character_states ADD COLUMN ${col.name} ${col.type}`).run();
      console.log(`   ✓ 已添加 ${col.name} 字段`);
    } else {
      console.log(`   • ${col.name} 字段已存在`);
    }
  }
} catch (err) {
  console.error("   ✗ 失败:", err.message);
}

// 3. 迁移现有数据到 type_specific_data (JSON)
console.log("\n3. 迁移现有修仙小说数据到 JSON 结构...");
try {
  const existingStates = db.prepare(`
    SELECT character_id, current_realm, inventory, status_effects
    FROM character_states
    WHERE (current_realm != '' OR inventory != '' OR status_effects != '')
    AND (type_specific_data = '{}' OR type_specific_data IS NULL)
  `).all();

  if (existingStates.length > 0) {
    const updateStmt = db.prepare(`
      UPDATE character_states
      SET type_specific_data = ?
      WHERE character_id = ?
    `);

    for (const state of existingStates) {
      const jsonData = JSON.stringify({
        realm: state.current_realm || "",
        inventory: state.inventory || "",
        status_effects: state.status_effects || ""
      });
      updateStmt.run(jsonData, state.character_id);
    }
    console.log(`   ✓ 已迁移 ${existingStates.length} 条现有数据`);
  } else {
    console.log("   • 无需迁移数据");
  }
} catch (err) {
  console.error("   ✗ 失败:", err.message);
}

db.close();
console.log("\n✅ 数据库升级完成！");
console.log("   • novels.state_template: 存储小说类型模板");
console.log("   • character_states.type_specific_data: 存储类型特定数据 (JSON)");
console.log("   • 现有修仙小说数据已保留并迁移\n");
