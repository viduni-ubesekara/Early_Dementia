/**
 * Conversational Cognitive Assessment Agent — scripted natural flow.
 *
 * Tone: warm, one question at a time, never "this is a test".
 * Optional Sri Lankan localisation for engagement (rice, Avurudu, temple).
 */

export function pickConversationVariant() {
  return Math.random() < 0.5 ? "srilanka" : "standard";
}

export function buildAssistantSteps(variant) {
  const lk = variant === "srilanka";
  return [
    {
      id: "greeting",
      text: lk
        ? "Hello! I'm so glad we can chat today. How are you feeling?"
        : "Hello! How are you feeling today? I'm really glad we can have a little chat.",
    },
    {
      id: "daily",
      text: lk
        ? "What did you do this morning? Maybe you had tea, or went somewhere — whatever you'd like to share."
        : "What did you do this morning? Take your time — there's no wrong answer.",
    },
    {
      id: "memory_routine",
      text: lk
        ? "What do you usually like for breakfast? Rice, string hoppers, bread — or something else?"
        : "Can you tell me what you usually have for breakfast, most days?",
    },
    {
      id: "memory_past",
      text: lk
        ? "What kind of work did you do when you were younger — or how did you spend your days?"
        : "What kind of work did you do when you were younger, or what kept you busy?",
    },
    {
      id: "orientation_natural",
      text: lk
        ? "Do you think today is more of a weekday feeling, or a weekend day?"
        : "Does today feel more like a weekday or a weekend to you?",
    },
    {
      id: "cultural",
      text: lk
        ? "Do you celebrate Avurudu at home? Or is there another festival your family enjoys?"
        : "Is there a festival or family gathering you remember fondly from recent years?",
    },
    {
      id: "emotional",
      text: lk
        ? "Have you been to the temple or somewhere peaceful recently? And do you feel fairly relaxed these days, or a bit stressed?"
        : "Do you feel fairly relaxed these days, or a little stressed?",
    },
    {
      id: "closing",
      text: lk
        ? "Thank you so much for chatting with me. That was really lovely. I hope you have a peaceful rest of your day."
        : "Thank you for chatting with me. That was really nice. I hope the rest of your day goes well.",
    },
  ];
}
