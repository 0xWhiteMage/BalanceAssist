export type BalanceFaqResponse = {
  messages: string[];
  sharedWorkQuery?: string;
};

export function getBalanceFaqResponse(message: string): BalanceFaqResponse | null {
  const normalized = message.toLowerCase();

  if (/what is balance|tell me about the company|know more about balance|tell me about balance studio/.test(normalized)) {
    return {
      messages: [
        'Balance Studio is a Singapore-based, full-service video and creative production house with 10+ years of experience, 100+ clients, and 110+ projects delivered worldwide.',
        "We handle the whole pipeline in-house — concept, production, post-production, motion graphics, VFX, design, and generative-AI workflows — with work for clients like Rolls-Royce, Canon, Netflix, Chanel, HSBC, and Nestlé."
      ]
    };
  }

  if (/do you guys do filming|can you do filming|do you do shoots|live-action/.test(normalized)) {
    return {
      messages: [
        "Yes — production is one of our core service pillars. We handle cinematic shoots, branded films, and corporate videos end-to-end: pre-production, on-set direction, lighting, sound, and full post after.",
        "Recent production work includes Canon's regional camera launch, the Dulux 'Rhythm of Blues' campaign, and Doctor Anywhere's DA Blanc work. If you'd like, I can also share a few production references."
      ],
      sharedWorkQuery: 'production canon dulux doctor anywhere'
    };
  }

  if (/founders|who founded|team|leadership/.test(normalized)) {
    return {
      messages: [
        'Balance was founded by Benjamin Ang (Business Director), Jamie Nguyen (Head of Production), and HaiHa Dang (Executive Creative Director).',
        "They operate across Singapore and Vietnam, with business-development contacts in the US and Europe. HaiHa also leads the studio's PURE NOW creative podcast."
      ]
    };
  }

  if (/past work|previous work|case stud|references|portfolio|show me(?: your)? work|share(?: your)? work/.test(normalized)) {
    return {
      messages: [
        'Absolutely — I can share a few relevant references.',
        "If you tell me the format or service you're interested in (for example 2D animation, event visuals, or product launch work), I'll pull the most relevant projects."
      ]
    };
  }

  return null;
}
