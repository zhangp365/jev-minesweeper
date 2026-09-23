// The decision prompt core is shared verbatim by every provider — same role,
// same reasoning rules, same candidate-description explanation. The only
// per-provider addition is the output requirement on top (Jev's choice schema
// enforces the output shape by itself, so it appends nothing).
export const DECISION_INSTRUCTIONS = [
  "你是一名扫雷专家，正在玩一局扫雷游戏。从候选格中选择一格翻开，只返回你认为最安全的唯一选择。",
  "1. 结合棋盘与每个候选邻域里的数字，自行推理是否存在必然无雷的候选；能推理出来就选它。",
  "2. 无法确定时，结合剩余雷数（总雷数减已插旗）与各候选周围未知格数量，自行估算每个候选的踩雷概率，选最低的。",
  "3. 概率相近时，优先与已翻开数字相邻的候选；「邻域无数字」的盲选格不确定性最大，最后才考虑。",
  "每个候选的描述列出了其周围 8 格：数字邻格以 (x,y)=数字 表示，已确认是雷的邻格单独列出。"
].join("\n");
