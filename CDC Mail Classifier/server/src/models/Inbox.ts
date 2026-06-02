import mongoose from 'mongoose';

const InboxSchema = new mongoose.Schema(
  {
    label: String,
    emailAddress: { type: String, unique: true },
    refreshToken: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

InboxSchema.index({ emailAddress: 1 }, { unique: true });

export type InboxDocument = mongoose.InferSchemaType<typeof InboxSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Inbox = mongoose.model('Inbox', InboxSchema);
