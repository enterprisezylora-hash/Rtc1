<template>
  <div class="app-container">
    <el-form :model="queryParams" :inline="true" size="small" label-width="70px">
      <el-form-item label="目标设备">
        <el-select v-model="queryParams.targetId" clearable filterable placeholder="全部" style="width: 220px">
          <el-option v-for="item in clientList" :key="item.id" :label="`${item.name} (${item.id})`" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="queryParams.enabled" clearable placeholder="全部" style="width: 120px">
          <el-option label="启用" :value="true" />
          <el-option label="停用" :value="false" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="el-icon-search" size="mini" @click="handleQuery">搜索</el-button>
        <el-button icon="el-icon-refresh" size="mini" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <el-row :gutter="10" class="mb8">
      <el-col :span="1.5">
        <el-button v-hasPermi="['rco:schedule:add']" type="primary" plain icon="el-icon-plus" size="mini" @click="handleAdd">新增计划</el-button>
      </el-col>
    </el-row>

    <el-table v-loading="loading" :data="scheduleList" border>
      <el-table-column label="ID" prop="id" min-width="180" />
      <el-table-column label="设备" min-width="160">
        <template slot-scope="scope">
          {{ getClientName(scope.row.targetId) }}
        </template>
      </el-table-column>
      <el-table-column label="媒体" min-width="180">
        <template slot-scope="scope">
          {{ getMediaName(scope.row.mediaId) }}
        </template>
      </el-table-column>
      <el-table-column label="开始时间" prop="startAt" min-width="160" />
      <el-table-column label="下次执行" prop="nextRunAt" min-width="160" />
      <el-table-column label="循环" prop="repeatMode" width="90" />
      <el-table-column label="音量" prop="volume" width="70" />
      <el-table-column label="启用" width="90">
        <template slot-scope="scope">
          <el-tag :type="scope.row.enabled ? 'success' : 'info'" size="mini">
            {{ scope.row.enabled ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220" class-name="small-padding fixed-width">
        <template slot-scope="scope">
          <el-button v-hasPermi="['rco:schedule:edit']" size="mini" type="text" icon="el-icon-edit" @click="handleUpdate(scope.row)">修改</el-button>
          <el-button v-hasPermi="['rco:schedule:edit']" size="mini" type="text" icon="el-icon-video-play" @click="toggleEnabled(scope.row)">
            {{ scope.row.enabled ? '停用' : '启用' }}
          </el-button>
          <el-button v-hasPermi="['rco:schedule:remove']" size="mini" type="text" icon="el-icon-delete" @click="handleDelete(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <pagination v-show="total > 0" :total="total" :page.sync="queryParams.pageNum" :limit.sync="queryParams.pageSize" @pagination="getList" />

    <el-dialog :title="title" :visible.sync="open" width="620px" append-to-body>
      <el-form ref="form" :model="form" :rules="rules" label-width="100px" size="small">
        <el-form-item label="目标设备">
          <el-select v-model="form.targetId" clearable filterable placeholder="留空=全部设备" style="width: 100%">
            <el-option v-for="item in clientList" :key="item.id" :label="`${item.name} (${item.id})`" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="媒体文件" prop="mediaId">
          <el-select v-model="form.mediaId" filterable placeholder="请选择媒体" style="width: 100%">
            <el-option v-for="item in mediaList" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="开始时间" prop="startAt">
          <el-date-picker v-model="form.startAt" type="datetime" value-format="yyyy-MM-dd'T'HH:mm:ss.SSS'Z'" style="width: 100%" />
        </el-form-item>
        <el-form-item label="重复模式" prop="repeatMode">
          <el-radio-group v-model="form.repeatMode">
            <el-radio label="once">once</el-radio>
            <el-radio label="daily">daily</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="音量">
          <el-slider v-model="form.volume" :min="0" :max="100" />
        </el-form-item>
        <el-form-item label="循环播放">
          <el-switch v-model="form.loop" />
        </el-form-item>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button type="primary" @click="submitForm">确 定</el-button>
        <el-button @click="cancel">取 消</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import { listClient } from '@/api/rco/client'
import { listMedia } from '@/api/rco/media'
import { addSchedule, delSchedule, listSchedule, updateSchedule } from '@/api/rco/schedule'

export default {
  name: 'RcoSchedule',
  data() {
    return {
      loading: false,
      open: false,
      title: '',
      total: 0,
      clientList: [],
      mediaList: [],
      scheduleList: [],
      queryParams: {
        pageNum: 1,
        pageSize: 10,
        targetId: '',
        enabled: undefined,
      },
      form: {
        id: null,
        targetId: '',
        mediaId: '',
        startAt: '',
        nextRunAt: '',
        repeatMode: 'once',
        loop: false,
        volume: 70,
        enabled: true,
      },
      rules: {
        mediaId: [{ required: true, message: '媒体不能为空', trigger: 'change' }],
        startAt: [{ required: true, message: '开始时间不能为空', trigger: 'change' }],
      },
    }
  },
  created() {
    this.initData()
  },
  methods: {
    async initData() {
      const [cRes, mRes] = await Promise.all([listClient({}), listMedia({})])
      this.clientList = cRes.rows || []
      this.mediaList = mRes.rows || []
      this.getList()
    },
    getClientName(id) {
      if (!id) return 'ALL'
      const found = this.clientList.find((item) => item.id === id)
      return found ? found.name : id
    },
    getMediaName(id) {
      const found = this.mediaList.find((item) => item.id === id)
      return found ? found.name : id
    },
    async getList() {
      this.loading = true
      try {
        const res = await listSchedule(this.queryParams)
        let rows = res.rows || []
        if (this.queryParams.targetId) {
          rows = rows.filter((item) => item.targetId === this.queryParams.targetId)
        }
        if (typeof this.queryParams.enabled === 'boolean') {
          rows = rows.filter((item) => Boolean(item.enabled) === this.queryParams.enabled)
        }
        this.scheduleList = rows
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
      this.queryParams.targetId = ''
      this.queryParams.enabled = undefined
      this.handleQuery()
    },
    resetFormData() {
      this.form = {
        id: null,
        targetId: '',
        mediaId: '',
        startAt: '',
        nextRunAt: '',
        repeatMode: 'once',
        loop: false,
        volume: 70,
        enabled: true,
      }
    },
    handleAdd() {
      this.resetFormData()
      this.open = true
      this.title = '新增计划任务'
    },
    handleUpdate(row) {
      this.form = {
        id: row.id,
        targetId: row.targetId || '',
        mediaId: row.mediaId,
        startAt: row.startAt,
        nextRunAt: row.nextRunAt,
        repeatMode: row.repeatMode,
        loop: Boolean(row.loop),
        volume: Number(row.volume || 70),
        enabled: Boolean(row.enabled),
      }
      this.open = true
      this.title = '修改计划任务'
    },
    cancel() {
      this.open = false
      this.resetFormData()
    },
    submitForm() {
      this.$refs.form.validate(async (valid) => {
        if (!valid) return
        const payload = {
          ...this.form,
          targetId: this.form.targetId || null,
          nextRunAt: this.form.nextRunAt || this.form.startAt,
        }
        if (payload.id) {
          await updateSchedule(payload)
          this.$modal.msgSuccess('修改成功')
        } else {
          await addSchedule(payload)
          this.$modal.msgSuccess('新增成功')
        }
        this.open = false
        this.getList()
      })
    },
    async toggleEnabled(row) {
      const payload = {
        ...row,
        enabled: !row.enabled,
      }
      await updateSchedule(payload)
      this.$modal.msgSuccess('状态更新成功')
      this.getList()
    },
    handleDelete(row) {
      this.$modal
        .confirm(`是否确认删除计划 ${row.id} ?`)
        .then(() => delSchedule(row.id))
        .then(() => {
          this.$modal.msgSuccess('删除成功')
          this.getList()
        })
        .catch(() => {})
    },
  },
}
</script>

<style scoped>
.mb8 {
  margin-bottom: 8px;
}
</style>
