<template>
  <div class="app-container">
    <el-row :gutter="20">
      <el-col :span="12">
        <el-card shadow="never" class="mb12">
          <div slot="header">
            <span>设备列表</span>
          </div>

          <el-form :inline="true" size="small" label-width="68px">
            <el-form-item label="刷新">
              <el-button type="primary" icon="el-icon-refresh" size="mini" @click="getClientList">刷新设备</el-button>
            </el-form-item>
          </el-form>

          <el-table v-loading="loadingClients" :data="clientList" border>
            <el-table-column label="设备ID" prop="id" min-width="180" />
            <el-table-column label="名称" prop="name" min-width="140" />
            <el-table-column label="类型" prop="type" width="100" />
            <el-table-column label="在线" width="88">
              <template slot-scope="scope">
                <el-tag :type="scope.row.online ? 'success' : 'danger'" size="mini">
                  {{ scope.row.online ? '在线' : '离线' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="屏幕" width="88">
              <template slot-scope="scope">
                <el-tag :type="scope.row.screenOn ? 'success' : 'info'" size="mini">
                  {{ scope.row.screenOn ? '开' : '关' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card shadow="never">
          <div slot="header">
            <span>命令审计日志</span>
          </div>

          <el-form :model="auditQuery" :inline="true" size="small" label-width="70px">
            <el-form-item label="设备ID">
              <el-input v-model="auditQuery.targetId" clearable placeholder="client.id" style="width: 180px" @keyup.enter.native="getAuditList" />
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="auditQuery.status" clearable placeholder="全部" style="width: 130px">
                <el-option label="queued" value="queued" />
                <el-option label="sent" value="sent" />
                <el-option label="acked" value="acked" />
                <el-option label="failed" value="failed" />
              </el-select>
            </el-form-item>
            <el-form-item label="TaskId">
              <el-input v-model="auditQuery.taskId" clearable placeholder="taskId" style="width: 190px" @keyup.enter.native="getAuditList" />
            </el-form-item>
            <el-form-item label="Type">
              <el-input v-model="auditQuery.type" clearable placeholder="10049" style="width: 120px" @keyup.enter.native="getAuditList" />
            </el-form-item>
            <el-form-item label="命令">
              <el-input v-model="auditQuery.commandType" clearable placeholder="server_task" style="width: 140px" @keyup.enter.native="getAuditList" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" icon="el-icon-search" size="mini" @click="getAuditList">搜索</el-button>
            </el-form-item>
          </el-form>

          <el-table v-loading="loadingAudit" :data="auditList" border>
            <el-table-column label="时间" prop="requestedAt" min-width="160" />
            <el-table-column label="设备" prop="deviceName" min-width="120" />
            <el-table-column label="TaskId" prop="taskId" min-width="200" />
            <el-table-column label="Type" prop="type" width="90" />
            <el-table-column label="状态" width="88">
              <template slot-scope="scope">
                <el-tag size="mini" :type="statusTag(scope.row.status)">{{ scope.row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="命令" prop="commandType" min-width="130" />
          </el-table>

          <pagination
            v-show="auditTotal > 0"
            :total="auditTotal"
            :page.sync="auditQuery.pageNum"
            :limit.sync="auditQuery.pageSize"
            @pagination="getAuditList"
          />
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card shadow="never" class="mb12">
          <div slot="header">
            <span>一键预设命令</span>
          </div>

          <el-form :model="presetForm" label-width="110px" size="small">
            <el-form-item label="预设命令">
              <el-select v-model="presetForm.key" placeholder="选择预设" style="width: 100%" @change="onPresetChange">
                <el-option v-for="item in presetList" :key="item.key" :label="`${item.key} (type:${item.type})`" :value="item.key" />
              </el-select>
            </el-form-item>

            <el-form-item label="目标设备">
              <el-select v-model="presetForm.targetId" filterable clearable placeholder="留空=全部设备" style="width: 100%">
                <el-option v-for="item in clientList" :key="item.id" :label="`${item.name} (${item.id})`" :value="item.id" />
              </el-select>
            </el-form-item>

            <el-form-item v-if="showPresetUnlockPwd" label="解锁密码">
              <el-input v-model="presetForm.unLockPwd" placeholder="unLockPwd" />
            </el-form-item>

            <el-form-item v-if="showPresetApkUrl" label="Web URL">
              <el-input v-model="presetForm.apkUrl" placeholder="https://example.com" />
            </el-form-item>

            <el-form-item label="消息">
              <el-input v-model="presetForm.msg" placeholder="msg" />
            </el-form-item>

            <el-form-item>
              <el-button v-hasPermi="['rco:control:preset']" type="primary" size="mini" @click="handleSendPreset">发送预设</el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never" class="mb12">
          <div slot="header">
            <span>Redis 监控</span>
          </div>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="运行模式">{{ redisHealth.mode || '-' }}</el-descriptions-item>
            <el-descriptions-item label="连接状态">
              <el-tag size="mini" :type="redisHealth.ready ? 'success' : 'warning'">{{ redisHealth.ready ? 'READY' : 'DEGRADED' }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="Instance">{{ redisHealth.instanceId || '-' }}</el-descriptions-item>
            <el-descriptions-item label="Stream长度">{{ redisStats.streamLength }}</el-descriptions-item>
            <el-descriptions-item label="List长度">{{ redisStats.listLength }}</el-descriptions-item>
          </el-descriptions>
          <div class="mt8">
            <el-button v-hasPermi="['rco:redis:monitor']" type="info" size="mini" icon="el-icon-refresh" @click="getRedisMonitor">刷新监控</el-button>
          </div>
        </el-card>

        <el-card shadow="never">
          <div slot="header">
            <span>原始 Task 命令</span>
          </div>

          <el-form :model="rawTaskForm" label-width="110px" size="small">
            <el-form-item label="Type">
              <el-input-number v-model="rawTaskForm.type" :min="1" :step="1" style="width: 100%" />
            </el-form-item>

            <el-form-item label="目标设备">
              <el-select v-model="rawTaskForm.targetId" filterable clearable placeholder="留空=全部设备" style="width: 100%">
                <el-option v-for="item in clientList" :key="item.id" :label="`${item.name} (${item.id})`" :value="item.id" />
              </el-select>
            </el-form-item>

            <el-form-item v-if="showRawUnlockPwd" label="解锁密码">
              <el-input v-model="rawTaskForm.unLockPwd" placeholder="unLockPwd" />
            </el-form-item>

            <el-form-item v-if="showRawApkUrl" label="Web URL">
              <el-input v-model="rawTaskForm.apkUrl" placeholder="https://example.com" />
            </el-form-item>

            <el-form-item label="消息">
              <el-input v-model="rawTaskForm.msg" placeholder="msg" />
            </el-form-item>

            <el-form-item>
              <el-button v-hasPermi="['rco:control:task']" type="warning" size="mini" @click="handleSendRawTask">发送 Raw Task</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script>
import { listClient } from '@/api/rco/client'
import { listCommandAudit, listTaskPresets, sendServerTask, sendTaskPreset } from '@/api/rco/control'
import { getRedisHealth, getRedisQueueStats } from '@/api/rco/redis'

export default {
  name: 'RcoDevice',
  data() {
    return {
      loadingClients: false,
      loadingAudit: false,
      clientList: [],
      presetList: [],
      auditList: [],
      auditTotal: 0,
      auditQuery: {
        pageNum: 1,
        pageSize: 10,
        targetId: '',
        status: '',
        taskId: '',
        type: '',
        commandType: '',
      },
      redisHealth: {},
      redisStats: {
        streamLength: '-',
        listLength: '-',
      },
      presetForm: {
        key: '',
        targetId: '',
        unLockPwd: '',
        apkUrl: '',
        msg: '',
      },
      rawTaskForm: {
        type: 10049,
        targetId: '',
        unLockPwd: '',
        apkUrl: '',
        msg: '',
      },
    }
  },
  computed: {
    showPresetUnlockPwd() {
      return this.presetForm.key === 'unlock'
    },
    showPresetApkUrl() {
      return this.presetForm.key === 'openWeb'
    },
    showRawUnlockPwd() {
      return Number(this.rawTaskForm.type) === 10021
    },
    showRawApkUrl() {
      return Number(this.rawTaskForm.type) === 10056
    },
  },
  created() {
    this.getClientList()
    this.getPresetList()
    this.getAuditList()
    this.getRedisMonitor()
  },
  methods: {
    statusTag(status) {
      if (status === 'queued') return 'info'
      if (status === 'sent') return 'warning'
      if (status === 'acked') return 'success'
      if (status === 'failed') return 'danger'
      return ''
    },
    notifySuccess(message) {
      if (this.$modal && this.$modal.msgSuccess) {
        this.$modal.msgSuccess(message)
        return
      }
      this.$message.success(message)
    },
    async getClientList() {
      this.loadingClients = true
      try {
        const res = await listClient({})
        this.clientList = res.rows || []
      } finally {
        this.loadingClients = false
      }
    },
    async getPresetList() {
      const res = await listTaskPresets()
      this.presetList = res.rows || []
      if (!this.presetForm.key && this.presetList.length > 0) {
        this.presetForm.key = this.presetList[0].key
        this.onPresetChange()
      }
    },
    async getAuditList() {
      this.loadingAudit = true
      try {
        const res = await listCommandAudit(this.auditQuery)
        this.auditList = res.rows || []
        this.auditTotal = Number(res.total || 0)
      } finally {
        this.loadingAudit = false
      }
    },
    async getRedisMonitor() {
      const [healthRes, statsRes] = await Promise.all([getRedisHealth(), getRedisQueueStats()])
      this.redisHealth = healthRes || {}
      const stats = (statsRes && statsRes.stats) || {}
      this.redisStats = {
        streamLength: typeof stats.streamLength === 'number' ? stats.streamLength : '-',
        listLength: typeof stats.listLength === 'number' ? stats.listLength : '-',
      }
    },
    onPresetChange() {
      const selected = this.presetList.find((item) => item.key === this.presetForm.key)
      const defaults = (selected && selected.defaults) || {}
      this.presetForm.msg = defaults.msg || ''
      this.presetForm.unLockPwd = defaults.unLockPwd || ''
      this.presetForm.apkUrl = defaults.apkUrl || ''
    },
    async handleSendPreset() {
      if (!this.presetForm.key) {
        this.$message.error('请选择预设命令')
        return
      }
      const payload = {
        targetId: this.presetForm.targetId || null,
        msg: this.presetForm.msg || '',
      }
      if (this.showPresetUnlockPwd) payload.unLockPwd = this.presetForm.unLockPwd || ''
      if (this.showPresetApkUrl) payload.apkUrl = this.presetForm.apkUrl || ''

      const res = await sendTaskPreset(this.presetForm.key, payload)
      this.notifySuccess(`已发送，queued=${res.queued}`)
      this.getAuditList()
    },
    async handleSendRawTask() {
      if (!this.rawTaskForm.type) {
        this.$message.error('Type 必填')
        return
      }
      const payload = {
        targetId: this.rawTaskForm.targetId || null,
        type: Number(this.rawTaskForm.type),
        msg: this.rawTaskForm.msg || '',
      }
      if (this.showRawUnlockPwd) payload.unLockPwd = this.rawTaskForm.unLockPwd || ''
      if (this.showRawApkUrl) payload.apkUrl = this.rawTaskForm.apkUrl || ''

      const res = await sendServerTask(payload)
      this.notifySuccess(`已发送，queued=${res.queued}`)
      this.getAuditList()
    },
  },
}
</script>

<style scoped>
.mb12 {
  margin-bottom: 12px;
}

.mt8 {
  margin-top: 8px;
}
</style>
