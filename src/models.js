const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'editor', 'reporter', 'reader'], default: 'reporter' },
  active: { type: Boolean, default: true },
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null }
}, { timestamps: true });

const newsSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 180 },
  titleEn: { type: String, trim: true, maxlength: 180, default: '' },
  summaryEn: { type: String, trim: true, maxlength: 500, default: '' },
  bodyEn: { type: String, maxlength: 30000, default: '' },
  summary: { type: String, required: true, trim: true, maxlength: 500 },
  body: { type: String, required: true, maxlength: 30000 },
  category: { type: String, required: true, enum: ['জাতীয়','আন্তর্জাতিক','রাজনীতি','অর্থনীতি','প্রযুক্তি','খেলাধুলা','বিনোদন','শিক্ষা','স্বাস্থ্য'] },
  image: { type: String, default: '' },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  source: { type: String, default: 'Amar Bangladesh' },
  status: { type: String, enum: ['draft','pending','published','rejected'], default: 'pending' },
  featured: { type: Boolean, default: false },
  views: { type: Number, default: 0 },
  publishedAt: { type: Date, default: null },
  tags: [{ type: String, maxlength: 30 }]
}, { timestamps: true });

newsSchema.index({ title: 'text', summary: 'text', body: 'text' });

const pollSchema = new mongoose.Schema({
  question: { type: String, required: true, maxlength: 240 },
  options: [{ label: { type: String, required: true }, votes: { type: Number, default: 0 } }],
  active: { type: Boolean, default: true },
  endsAt: Date
}, { timestamps: true });

const voteSchema = new mongoose.Schema({
  poll: { type: mongoose.Schema.Types.ObjectId, ref: 'Poll', required: true },
  voterKey: { type: String, required: true },
  optionIndex: { type: Number, required: true }
}, { timestamps: true });
voteSchema.index({ poll: 1, voterKey: 1 }, { unique: true });

const subscriberSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const liveUpdateSchema = new mongoose.Schema({ title: {type:String,required:true,maxlength:180}, body:{type:String,required:true,maxlength:3000}, active:{type:Boolean,default:true}, author:{type:mongoose.Schema.Types.ObjectId,ref:'User'} }, {timestamps:true});
const commentSchema = new mongoose.Schema({ news:{type:mongoose.Schema.Types.ObjectId,ref:'News',required:true,index:true}, user:{type:mongoose.Schema.Types.ObjectId,ref:'User'}, name:{type:String,required:true,maxlength:80}, body:{type:String,required:true,maxlength:2000}, status:{type:String,enum:['pending','approved','rejected'],default:'pending'} }, {timestamps:true});
const mediaSchema = new mongoose.Schema({ kind:{type:String,enum:['video','photo'],required:true}, title:{type:String,required:true,maxlength:180}, url:{type:String,required:true}, caption:{type:String,default:''}, active:{type:Boolean,default:true}, author:{type:mongoose.Schema.Types.ObjectId,ref:'User'} }, {timestamps:true});
const adSchema = new mongoose.Schema({ name:{type:String,required:true}, placement:{type:String,enum:['top','sidebar','in-article','footer'],default:'sidebar'}, imageUrl:String, targetUrl:String, html:String, active:{type:Boolean,default:true}, startsAt:Date, endsAt:Date, impressions:{type:Number,default:0}, clicks:{type:Number,default:0} }, {timestamps:true});
const pushSchema = new mongoose.Schema({ user:{type:mongoose.Schema.Types.ObjectId,ref:'User'}, endpoint:{type:String,required:true,unique:true}, keys:{p256dh:String,auth:String} }, {timestamps:true});

const notificationSchema = new mongoose.Schema({
  title: String, message: String, type: { type: String, default: 'info' }, read: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = {
  User: mongoose.model('User', userSchema),
  News: mongoose.model('News', newsSchema),
  Poll: mongoose.model('Poll', pollSchema),
  Vote: mongoose.model('Vote', voteSchema),
  Subscriber: mongoose.model('Subscriber', subscriberSchema),
  Notification: mongoose.model('Notification', notificationSchema),
  LiveUpdate: mongoose.model('LiveUpdate', liveUpdateSchema), 
  Comment: mongoose.model('Comment', commentSchema),
  Media: mongoose.model('Media', mediaSchema), 
  Ad: mongoose.model('Ad', adSchema), 
  PushSubscription: mongoose.model('PushSubscription', pushSchema)
};
