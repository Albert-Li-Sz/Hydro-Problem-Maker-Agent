import { isSafeFlatName } from "@hydro-problem-make/authoring";

export interface HydroAgentAttachment {
	name: string;
	contentBase64: string;
}

export function decodeAgentAttachments(attachments: readonly HydroAgentAttachment[]): Array<{
	name: string;
	content: Uint8Array;
}> {
	const names = new Set<string>();
	return attachments.map((attachment) => {
		if (!isSafeFlatName(attachment.name) || names.has(attachment.name))
			throw new Error("附件名称必须是唯一的扁平 ASCII 文件名。");
		names.add(attachment.name);
		const content = Buffer.from(attachment.contentBase64, "base64");
		if (content.toString("base64") !== attachment.contentBase64.replace(/\s/g, ""))
			throw new Error(`附件 ${attachment.name} 不是规范的 Base64。`);
		return { name: attachment.name, content };
	});
}
