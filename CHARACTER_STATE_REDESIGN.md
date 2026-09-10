# 角色动态账本系统重新设计方案

## 🔍 问题诊断

### 当前设计的致命缺陷
```sql
CREATE TABLE character_states (
  current_location TEXT,      -- ✅ 通用（所有类型小说都有位置）
  current_realm TEXT,          -- ❌ 只适用于修仙/玄幻（境界、等级）
  inventory TEXT,              -- ❌ 只适用于奇幻/游戏文（法宝、装备）
  status_effects TEXT,         -- ⚠️ 部分适用（伤病、诅咒）
  notes TEXT                   -- ✅ 通用（备注）
);
```

### 不同类型小说的角色动态追踪需求

| 小说类型 | 核心动态维度 | 示例 |
|---------|------------|------|
| **修仙/玄幻** | 境界、法宝、伤势 | 筑基期 → 金丹期 → 元婴期 / 获得紫霄剑 / 经脉受损 |
| **言情/都市** | 情感关系、社会地位、关键事件 | 与男主从陌生 → 暧昧 → 恋爱 → 分手 / 从实习生晋升为总监 / 第 20 章得知身世秘密 |
| **悬疑/推理** | 嫌疑度、已知线索、行踪 | 第 10 章成为嫌疑人 / 掌握 A 的不在场证明 / 第 15 章失踪 |
| **历史/架空** | 官职、政治立场、军事实力 | 从县令升至刺史 / 从中立转为支持太子 / 麾下兵力 3 万 |
| **科幻** | 科技等级、改造程度、阵营 | 二级赛博改造 / 加入反抗军 / 掌握量子通讯密钥 |
| **游戏异界** | 等级、技能、装备 | Lv 25 → Lv 40 / 学会火球术 / 获得传说武器 |

---

## ✅ 解决方案：类型自适应动态账本

### 方案 A：通用字段 + JSON 扩展（推荐）

#### 数据库设计
```sql
CREATE TABLE character_states (
  character_id INTEGER PRIMARY KEY,
  novel_id INTEGER NOT NULL,
  
  -- 通用核心字段（所有类型小说都适用）
  current_location TEXT DEFAULT '',           -- 当前位置/场景
  key_relationships TEXT DEFAULT '',          -- 核心人际关系（JSON）
  recent_events TEXT DEFAULT '',              -- 最近 3 章的关键事件
  
  -- 类型特定字段（JSON 格式，根据小说类型填充）
  type_specific_data TEXT DEFAULT '{}',       -- JSON: 修仙用境界/言情用情感状态/悬疑用嫌疑度
  
  -- 元数据
  updated_at TEXT DEFAULT (datetime('now'))
);
```

#### JSON 结构示例

**修仙小说**:
```json
{
  "realm": "金丹中期",
  "cultivation_method": "太玄心法第七层",
  "treasures": ["紫霄剑(灵器)", "炼妖壶"],
  "injuries": "丹田有暗伤，剑气紊乱",
  "faction": "青云宗外门弟子"
}
```

**言情小说**:
```json
{
  "relationship_with_ml": "暧昧期（互有好感但未表白）",
  "social_status": "XM 集团市场部经理",
  "emotional_state": "因误会对男主有芥蒂",
  "key_secret": "第 18 章得知自己是豪门私生女",
  "rival": "白月光林清雅"
}
```

**悬疑推理**:
```json
{
  "suspicion_level": "重点嫌疑人",
  "alibi": "案发时在咖啡厅，有监控",
  "known_clues": ["知道受害者的秘密账户", "第 12 章出现在案发现场附近"],
  "motive": "与受害者有 500 万债务纠纷",
  "current_status": "被警方传唤中"
}
```

**都市职场**:
```json
{
  "position": "天盛集团副总裁",
  "career_trajectory": "基层销售 → 区域经理 → 副总裁（第 30 章升职）",
  "key_skill": "擅长资本运作与并购谈判",
  "faction": "董事长嫡系，与 CFO 派系对立",
  "current_project": "负责与海外 A 集团的并购案"
}
```

---

### 方案 B：预设模板系统（用户友好）

#### 小说创建时选择追踪模板

```typescript
const CHARACTER_STATE_TEMPLATES = {
  xuanhuan: {
    name: "修仙/玄幻",
    fields: [
      { key: "realm", label: "境界/等级", type: "text", placeholder: "如：筑基期、金丹期" },
      { key: "cultivation", label: "功法/武学", type: "text" },
      { key: "treasures", label: "法宝/神兵", type: "text" },
      { key: "injuries", label: "伤势/状态", type: "text" },
      { key: "faction", label: "门派/阵营", type: "text" }
    ]
  },
  
  romance: {
    name: "言情/都市",
    fields: [
      { key: "relationship", label: "与主角关系", type: "select", options: ["陌生", "暧昧", "恋爱", "分手", "复合", "结婚"] },
      { key: "social_status", label: "社会地位", type: "text", placeholder: "如：公司职位、家族背景" },
      { key: "emotional_state", label: "情感状态", type: "text" },
      { key: "secrets", label: "身世/秘密", type: "text" },
      { key: "rival", label: "情敌/对手", type: "text" }
    ]
  },
  
  mystery: {
    name: "悬疑/推理",
    fields: [
      { key: "suspicion", label: "嫌疑等级", type: "select", options: ["无关人员", "证人", "疑点人物", "重点嫌疑人", "犯罪嫌疑人", "已排除"] },
      { key: "alibi", label: "不在场证明", type: "text" },
      { key: "motive", label: "作案动机", type: "text" },
      { key: "clues", label: "掌握线索", type: "textarea" },
      { key: "current_action", label: "当前行踪", type: "text" }
    ]
  },
  
  history: {
    name: "历史/架空",
    fields: [
      { key: "title", label: "官职/爵位", type: "text", placeholder: "如：县令、刺史、侯爵" },
      { key: "political_stance", label: "政治立场", type: "text" },
      { key: "military_power", label: "军事实力", type: "text", placeholder: "如：麾下兵力 3 万" },
      { key: "territory", label: "封地/势力范围", type: "text" },
      { key: "faction", label: "党派/阵营", type: "text" }
    ]
  },
  
  scifi: {
    name: "科幻",
    fields: [
      { key: "tech_level", label: "科技等级", type: "text", placeholder: "如：二级改造人、量子意识" },
      { key: "augmentation", label: "机械/基因改造", type: "text" },
      { key: "faction", label: "阵营/组织", type: "text" },
      { key: "clearance", label: "权限等级", type: "text" },
      { key: "special_access", label: "特殊资源", type: "text" }
    ]
  },
  
  game: {
    name: "游戏异界",
    fields: [
      { key: "level", label: "等级", type: "number" },
      { key: "class", label: "职业/转职", type: "text" },
      { key: "skills", label: "技能列表", type: "textarea" },
      { key: "equipment", label: "装备", type: "textarea" },
      { key: "guild", label: "公会/队伍", type: "text" }
    ]
  },
  
  custom: {
    name: "自定义",
    fields: [] // 允许用户自己添加字段
  }
};
```

#### 用户体验流程

1. **创建小说时选择类型**
   ```tsx
   <select onChange={(e) => setStateTemplate(e.target.value)}>
     <option value="xuanhuan">修仙/玄幻（追踪境界、法宝）</option>
     <option value="romance">言情/都市（追踪关系、地位）</option>
     <option value="mystery">悬疑/推理（追踪嫌疑、线索）</option>
     <option value="history">历史/架空（追踪官职、军力）</option>
     <option value="custom">自定义字段</option>
   </select>
   ```

2. **人物卡自动显示对应字段**
   ```tsx
   // 修仙小说显示
   <div>境界: 金丹期</div>
   <div>法宝: 紫霄剑、炼妖壶</div>
   
   // 言情小说显示
   <div>与男主关系: 暧昧期</div>
   <div>社会地位: 市场部经理</div>
   ```

3. **Agent 自动识别类型**
   ```typescript
   // Agent 根据小说类型自动调整提示词
   if (novel.genre === "言情" || novel.genre === "都市") {
     prompt = "请提取角色的关系进展、职位变化、情感状态";
   } else if (novel.genre === "玄幻" || novel.genre === "仙侠") {
     prompt = "请提取角色的境界突破、法宝获得、伤势变化";
   }
   ```

---

## 🚀 实施方案

### 阶段 1：数据库升级（向后兼容）

```sql
-- 1. 重命名旧字段（兼容现有修仙小说）
ALTER TABLE character_states RENAME COLUMN current_realm TO legacy_realm;
ALTER TABLE character_states RENAME COLUMN inventory TO legacy_inventory;
ALTER TABLE character_states RENAME COLUMN status_effects TO legacy_status_effects;

-- 2. 新增通用字段
ALTER TABLE character_states ADD COLUMN key_relationships TEXT DEFAULT '';
ALTER TABLE character_states ADD COLUMN recent_events TEXT DEFAULT '';
ALTER TABLE character_states ADD COLUMN type_specific_data TEXT DEFAULT '{}';

-- 3. 数据迁移：将旧数据转换为 JSON
UPDATE character_states SET type_specific_data = json_object(
  'realm', legacy_realm,
  'inventory', legacy_inventory,
  'status_effects', legacy_status_effects
) WHERE legacy_realm != '' OR legacy_inventory != '' OR legacy_status_effects != '';
```

### 阶段 2：前端 UI 适配

```tsx
// web/src/pages/author/Characters.tsx
function CharacterStateDisplay({ character, novel }) {
  const template = CHARACTER_STATE_TEMPLATES[novel.genre] || CHARACTER_STATE_TEMPLATES.custom;
  const stateData = JSON.parse(character.state.type_specific_data || '{}');
  
  return (
    <div className="space-y-2">
      {/* 通用字段 */}
      <div>当前位置: {character.state.current_location || "未知"}</div>
      
      {/* 类型特定字段 */}
      {template.fields.map(field => (
        <div key={field.key}>
          {field.label}: {stateData[field.key] || "未设定"}
        </div>
      ))}
      
      {/* 最近事件 */}
      {character.state.recent_events && (
        <div className="text-xs text-ink-3 mt-2">
          最近动态: {character.state.recent_events}
        </div>
      )}
    </div>
  );
}
```

### 阶段 3：Agent 工具升级

```typescript
// server/src/agent.ts
{
  name: "update_character_state",
  description: `更新角色动态账本。根据小说类型自动识别需要追踪的字段：
    - 修仙/玄幻: 境界、法宝、伤势
    - 言情/都市: 关系进展、社会地位、情感状态
    - 悬疑/推理: 嫌疑等级、掌握线索、不在场证明
    - 历史/架空: 官职、政治立场、军事实力`,
  inputSchema: {
    type: "object",
    properties: {
      characterId: { type: "number" },
      novelId: { type: "number" },
      location: { type: "string", description: "当前位置" },
      relationships: { type: "string", description: "关键人际关系变化" },
      recentEvents: { type: "string", description: "最近 1-3 章的关键事件" },
      typeSpecificData: { 
        type: "object", 
        description: "类型特定数据（JSON 对象，如修仙小说填 realm/treasures，言情小说填 relationship/social_status）" 
      }
    },
    required: ["characterId", "novelId"]
  }
}
```

---

## 📊 优化效果预测

### 覆盖率提升
| 小说类型 | 优化前适用性 | 优化后适用性 |
|---------|------------|------------|
| 修仙/玄幻 | ✅ 100% | ✅ 100% |
| 言情/都市 | ❌ 20% | ✅ 95% |
| 悬疑/推理 | ❌ 30% | ✅ 90% |
| 历史/架空 | ❌ 40% | ✅ 90% |
| 科幻 | ❌ 50% | ✅ 85% |
| 游戏异界 | ⚠️ 70% | ✅ 100% |

### 用户体验提升
- **修仙作者**: 无感知（字段名改变但功能一致）
- **言情作者**: 🎉 终于能追踪男女主关系进展了！
- **悬疑作者**: 🎉 可以记录每个角色的嫌疑度和掌握的线索！

---

## 🎯 推荐实施方案

### 方案 1：快速修复（1 天）
- 将 `current_realm` 改为 `dynamic_field_1`，UI 显示"境界/关系/官职"（根据类型切换标签）
- 将 `inventory` 改为 `dynamic_field_2`，UI 显示"法宝/秘密/线索"
- 只改标签，不改数据结构

**优点**: 快速上线，向后兼容  
**缺点**: 字段语义不够清晰

### 方案 2：完整重构（3-5 天，推荐）
- 按照上述"方案 B：预设模板系统"完整实施
- 小说创建时选择追踪模板
- Agent 自动识别类型并填充对应字段

**优点**: 彻底解决问题，用户体验最佳  
**缺点**: 开发量稍大，需要数据迁移

---

## 💡 额外优化建议

### 1. 关系图谱可视化（言情小说神器）
```tsx
// 用 React Flow 展示人物关系网
<ReactFlow nodes={characters} edges={relationships}>
  <Node data={{ name: "女主", relationship: "与男主暧昧" }} />
  <Edge source="女主" target="男主" label="暧昧期（第 20 章表白）" />
  <Edge source="女主" target="白月光" label="情敌关系" style={{ stroke: 'red' }} />
</ReactFlow>
```

### 2. 时间线追踪（悬疑小说神器）
```tsx
// 显示角色在各章的行踪与状态变化
<Timeline>
  <Event chapter={10} content="第 10 章：出现在案发现场附近" />
  <Event chapter={15} content="第 15 章：失踪，无法联系" />
  <Event chapter={20} content="第 20 章：被警方传唤" />
</Timeline>
```

### 3. AI 自动推断类型
```typescript
// 创建小说时 AI 自动推荐模板
async function suggestTemplate(title: string, intro: string) {
  const keywords = {
    xuanhuan: ["修仙", "境界", "法宝", "宗门", "灵气"],
    romance: ["爱情", "恋爱", "霸总", "甜宠", "婚姻"],
    mystery: ["案件", "侦探", "凶手", "推理", "真相"]
  };
  
  // 根据关键词匹配推荐模板
  // ...
}
```

---

## 🚀 立即可执行的最小改动方案

**如果只有 1 小时，最优先做这个**：

```typescript
// 1. 在 novels 表增加 state_template 字段（5 分钟）
ALTER TABLE novels ADD COLUMN state_template TEXT DEFAULT 'xuanhuan';

// 2. UI 上根据 genre 自动调整字段标签（30 分钟）
const FIELD_LABELS = {
  xuanhuan: { realm: "境界", inventory: "法宝", status: "伤势" },
  romance: { realm: "关系", inventory: "秘密", status: "情感状态" },
  mystery: { realm: "嫌疑度", inventory: "掌握线索", status: "行踪" }
};

const labels = FIELD_LABELS[novel.genre] || FIELD_LABELS.xuanhuan;

// 3. Agent 提示词动态调整（15 分钟）
const agentHint = novel.genre === "romance" 
  ? "请提取角色关系进展、社会地位变化、情感状态"
  : "请提取角色境界突破、法宝获得、伤势变化";
```

**效果**: 
- ✅ 修仙小说：无影响（显示"境界"、"法宝"）
- ✅ 言情小说：自动显示"关系"、"秘密"
- ✅ 悬疑小说：自动显示"嫌疑度"、"掌握线索"

**成本**: 1 小时开发 + 0 数据迁移
