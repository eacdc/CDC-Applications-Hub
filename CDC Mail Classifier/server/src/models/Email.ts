import mongoose from 'mongoose';

const EmailSchema = new mongoose.Schema(
  {
    messageId: { type: String, required: true, unique: true },
    threadId: String,
    inbox: String,
    fromName: String,
    fromEmail: String,
    toField: String,
    ccField: String,
    subject: String,
    sentDate: Date,
    gmailLink: String,
    body: String,
    attachments: [String],
    department: String,
    mailType: String,
    confidence: Number,
    needsReview: Boolean,
    classifier: String,
    jobNumber: String,
    clientName: String,
    isbn: String,
    title: String,
    quantity: String,
    dueDate: String,
    summary: String,
    actionRequired: String,
    typeSpecific: mongoose.Schema.Types.Mixed,
    reviewed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

EmailSchema.index({ messageId: 1 }, { unique: true });
EmailSchema.index({ needsReview: 1, sentDate: 1 });
EmailSchema.index({ department: 1, mailType: 1 });
EmailSchema.index({ inbox: 1, sentDate: -1 });

export type EmailDocument = mongoose.InferSchemaType<typeof EmailSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Email = mongoose.model('Email', EmailSchema);
