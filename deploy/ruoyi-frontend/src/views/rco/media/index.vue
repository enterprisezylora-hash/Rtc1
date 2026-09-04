<template>
  <div class="app-container">
    <el-form :model="queryParams" ref="queryForm" :inline="true" size="small" label-width="68px">
      <el-form-item label="名称" prop="name">
        <el-input v-model="queryParams.name" placeholder="媒体名称" clearable style="width: 220px" @keyup.enter.native="handleQuery" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="el-icon-search" size="mini" @click="handleQuery">搜索</el-button>
        <el-button icon="el-icon-refresh" size="mini" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <el-row :gutter="10" class="mb8">
      <el-col :span="1.5">
        <el-button v-hasPermi="['rco:media:add']" type="primary" plain icon="el-icon-plus" size="mini" @click="handleAdd">新增</el-button>
      </el-col>
      <el-col :span="1.5">
        <el-button v-hasPermi="['rco:media:upload']" type="success" plain icon="el-icon-upload" size="mini" @click="handleUpload">上传</el-button>
      </el-col>
    </el-row>

    <el-table v-loading="loading" :data="mediaList" border>
      <el-table-column label="ID" prop="id" min-width="170" />
      <el-table-column label="名称" prop="name" min-width="140" />
      <el-table-column label="类型" prop="mimeType" min-width="150" />
      <el-table-column label="大小" prop="size" width="100" />
      <el-table-column label="URL" prop="url" min-width="250" show-overflow-tooltip />
      <el-table-column label="创建时间" prop="createdAt" min-width="160" />
      <el-table-column label="操作" width="190" class-name="small-padding fixed-width">
        <template slot-scope="scope">
          <el-button v-hasPermi="['rco:media:edit']" size="mini" type="text" icon="el-icon-edit" @click="handleUpdate(scope.row)">修改</el-button>
          <el-button v-hasPermi="['rco:media:remove']" size="mini" type="text" icon="el-icon-delete" @click="handleDelete(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <pagination v-show="total > 0" :total="total" :page.sync="queryParams.pageNum" :limit.sync="queryParams.pageSize" @pagination="getList" />

    <el-dialog :title="title" :visible.sync="open" width="560px" append-to-body>
      <el-form ref="form" :model="form" :rules="rules" label-width="90px" size="small">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入名称" />
        </el-form-item>
        <el-form-item label="URL" prop="url">
          <el-input v-model="form.url" placeholder="https://..." />
        </el-form-item>
        <el-form-item label="类型" prop="mimeType">
          <el-input v-model="form.mimeType" placeholder="video/mp4" />
        </el-form-item>
        <el-form-item label="大小" prop="size">
          <el-input-number v-model="form.size" :min="0" style="width: 100%" />
        </el-form-item>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button type="primary" @click="submitForm">确 定</el-button>
        <el-button @click="cancel">取 消</el-button>
      </div>
    </el-dialog>

    <el-dialog title="上传媒体" :visible.sync="uploadOpen" width="520px" append-to-body>
      <el-upload
        ref="uploader"
        action=""
        :auto-upload="false"
        :http-request="doUpload"
        :show-file-list="true"
        :limit="1"
        accept="video/*,audio/*,image/*"
      >
        <el-button size="small" type="primary">选择文件</el-button>
      </el-upload>
      <div slot="footer" class="dialog-footer">
        <el-button type="primary" @click="submitUpload">上 传</el-button>
        <el-button @click="uploadOpen = false">取 消</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import { addMedia, delMedia, listMedia, updateMedia, uploadMedia } from '@/api/rco/media'

export default {
  name: 'RcoMedia',
  data() {
    return {
      loading: false,
      mediaList: [],
      total: 0,
      title: '',
      open: false,
      uploadOpen: false,
      queryParams: {
        pageNum: 1,
        pageSize: 10,
        name: '',
      },
      form: {
        id: null,
        name: '',
        url: '',
        mimeType: 'application/octet-stream',
        size: 0,
      },
      rules: {
        name: [{ required: true, message: '名称不能为空', trigger: 'blur' }],
        url: [{ required: true, message: 'URL不能为空', trigger: 'blur' }],
      },
    }
  },
  created() {
    this.getList()
  },
  methods: {
    async getList() {
      this.loading = true
      try {
        const res = await listMedia(this.queryParams)
        const rows = (res.rows || []).filter((item) => {
          if (!this.queryParams.name) return true
          return (item.name || '').toLowerCase().includes(this.queryParams.name.toLowerCase())
        })
        this.mediaList = rows
        this.total = Number(res.total || rows.length)
      } finally {
        this.loading = false
      }
    },
    handleQuery() {
      this.queryParams.pageNum = 1
      this.getList()
    },
    resetQuery() {
      this.queryParams.name = ''
      this.handleQuery()
    },
    resetFormData() {
      this.form = {
        id: null,
        name: '',
        url: '',
        mimeType: 'application/octet-stream',
        size: 0,
      }
    },
    handleAdd() {
      this.resetFormData()
      this.open = true
      this.title = '新增媒体'
    },
    handleUpdate(row) {
      this.form = {
        id: row.id,
        name: row.name,
        url: row.url,
        mimeType: row.mimeType,
        size: Number(row.size || 0),
      }
      this.open = true
      this.title = '修改媒体'
    },
    cancel() {
      this.open = false
      this.resetFormData()
    },
    submitForm() {
      this.$refs.form.validate(async (valid) => {
        if (!valid) return
        if (this.form.id) {
          await updateMedia(this.form)
          this.$modal.msgSuccess('修改成功')
        } else {
          await addMedia(this.form)
          this.$modal.msgSuccess('新增成功')
        }
        this.open = false
        this.getList()
      })
    },
    handleDelete(row) {
      this.$modal
        .confirm(`是否确认删除媒体 ${row.name} ?`)
        .then(() => delMedia(row.id))
        .then(() => {
          this.$modal.msgSuccess('删除成功')
          this.getList()
        })
        .catch(() => {})
    },
    handleUpload() {
      this.uploadOpen = true
    },
    submitUpload() {
      this.$refs.uploader.submit()
    },
    async doUpload(payload) {
      const formData = new FormData()
      formData.append('file', payload.file)
      await uploadMedia(formData)
      this.$modal.msgSuccess('上传成功')
      this.uploadOpen = false
      this.getList()
    },
  },
}
</script>

<style scoped>
.mb8 {
  margin-bottom: 8px;
}
</style>
