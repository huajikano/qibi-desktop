// 角色动态账本类型特定字段模板定义
export interface CharacterField {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "number";
  placeholder?: string;
  options?: string[];
}

export interface CharacterStateTemplate {
  name: string;
  fields: CharacterField[];
}

export const CHARACTER_STATE_TEMPLATES: Record<string, CharacterStateTemplate> = {
  xuanhuan: {
    name: "修仙/玄幻",
    fields: [
      { key: "realm", label: "境界/等级", type: "text", placeholder: "如：筑基期、金丹期、元婴期" },
      { key: "cultivation", label: "功法/武学", type: "text", placeholder: "如：太玄心法第七层" },
      { key: "treasures", label: "法宝/神兵", type: "text", placeholder: "如：紫霄剑(灵器)、炼妖壶" },
      { key: "injuries", label: "伤势/状态", type: "text", placeholder: "如：丹田暗伤、剑气紊乱" },
      { key: "faction", label: "门派/阵营", type: "text", placeholder: "如：青云宗外门弟子" },
    ],
  },
  romance: {
    name: "言情/都市",
    fields: [
      {
        key: "relationship",
        label: "与主角关系",
        type: "select",
        options: ["陌生", "认识", "暧昧", "恋爱", "分手", "复合", "结婚"],
      },
      { key: "social_status", label: "社会地位", type: "text", placeholder: "如：XM集团市场部经理、豪门千金" },
      { key: "emotional_state", label: "情感状态", type: "text", placeholder: "如：因误会对男主有芥蒂" },
      { key: "secrets", label: "身世/秘密", type: "textarea", placeholder: "如：第18章得知自己是豪门私生女" },
      { key: "rival", label: "情敌/对手", type: "text", placeholder: "如：白月光林清雅" },
    ],
  },
  mystery: {
    name: "悬疑/推理",
    fields: [
      {
        key: "suspicion",
        label: "嫌疑等级",
        type: "select",
        options: ["无关人员", "证人", "疑点人物", "重点嫌疑人", "犯罪嫌疑人", "已排除"],
      },
      { key: "alibi", label: "不在场证明", type: "text", placeholder: "如：案发时在咖啡厅，有监控" },
      { key: "motive", label: "作案动机", type: "text", placeholder: "如：与受害者有500万债务纠纷" },
      { key: "clues", label: "掌握线索", type: "textarea", placeholder: "如：知道受害者的秘密账户" },
      { key: "current_action", label: "当前行踪", type: "text", placeholder: "如：被警方传唤中" },
    ],
  },
  history: {
    name: "历史/架空",
    fields: [
      { key: "title", label: "官职/爵位", type: "text", placeholder: "如：县令、刺史、侯爵" },
      { key: "political_stance", label: "政治立场", type: "text", placeholder: "如：支持太子、中立" },
      { key: "military_power", label: "军事实力", type: "text", placeholder: "如：麾下兵力3万" },
      { key: "territory", label: "封地/势力范围", type: "text", placeholder: "如：江南三郡" },
      { key: "faction", label: "党派/阵营", type: "text", placeholder: "如：太子党、皇后派" },
    ],
  },
  scifi: {
    name: "科幻",
    fields: [
      { key: "tech_level", label: "科技等级", type: "text", placeholder: "如：二级改造人、量子意识" },
      { key: "augmentation", label: "机械/基因改造", type: "text", placeholder: "如：左臂义肢、强化神经" },
      { key: "faction", label: "阵营/组织", type: "text", placeholder: "如：反抗军、联邦军" },
      { key: "clearance", label: "权限等级", type: "text", placeholder: "如：A级权限" },
      { key: "special_access", label: "特殊资源", type: "text", placeholder: "如：掌握量子通讯密钥" },
    ],
  },
  game: {
    name: "游戏异界",
    fields: [
      { key: "level", label: "等级", type: "number", placeholder: "如：40" },
      { key: "class", label: "职业/转职", type: "text", placeholder: "如：剑圣、大魔导师" },
      { key: "skills", label: "技能列表", type: "textarea", placeholder: "如：烈焰斩、冰霜新星、瞬移" },
      { key: "equipment", label: "装备", type: "textarea", placeholder: "如：传说武器-破军剑、神话防具-龙鳞甲" },
      { key: "guild", label: "公会/队伍", type: "text", placeholder: "如：无双公会、精英小队" },
    ],
  },
  custom: {
    name: "自定义",
    fields: [],
  },
};

// 根据小说类型获取Agent提示词片段
export function getAgentHintForGenre(genre: string): string {
  const normalized = genre?.toLowerCase() || "";

  if (normalized.includes("言情") || normalized.includes("都市") || normalized.includes("现代")) {
    return "请提取角色的关系进展、社会地位变化、情感状态、身世秘密等动态信息";
  }

  if (normalized.includes("悬疑") || normalized.includes("推理") || normalized.includes("犯罪")) {
    return "请提取角色的嫌疑等级、掌握线索、不在场证明、作案动机、当前行踪等动态信息";
  }

  if (normalized.includes("历史") || normalized.includes("架空")) {
    return "请提取角色的官职变动、政治立场、军事实力、封地势力等动态信息";
  }

  if (normalized.includes("科幻") || normalized.includes("未来")) {
    return "请提取角色的科技等级、改造程度、阵营组织、权限等级等动态信息";
  }

  if (normalized.includes("游戏") || normalized.includes("异界") || normalized.includes("网游")) {
    return "请提取角色的等级、职业、技能、装备、公会等动态信息";
  }

  // 默认修仙/玄幻
  return "请提取角色的境界突破、功法修炼、法宝获得、伤势变化、门派阵营等动态信息";
}
